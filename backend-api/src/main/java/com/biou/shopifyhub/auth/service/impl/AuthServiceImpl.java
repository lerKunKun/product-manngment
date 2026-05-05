package com.biou.shopifyhub.auth.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.dto.LoginRequest;
import com.biou.shopifyhub.auth.dto.LoginResponse;
import com.biou.shopifyhub.auth.dto.LoginResult;
import com.biou.shopifyhub.auth.service.AuthService;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.metrics.MetricsRegistry;
import com.biou.shopifyhub.core.security.JwtUtil;
import com.biou.shopifyhub.core.security.SessionInfo;
import com.biou.shopifyhub.core.security.SessionService;
import com.biou.shopifyhub.rbac.UserRolePermissionService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class AuthServiceImpl implements AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthServiceImpl.class);
    private static final int MAX_FAILS = 5;
    private static final Duration FAIL_WINDOW = Duration.ofMinutes(15);
    private static final Duration BLACKLIST_TTL = Duration.ofDays(7);

    private final SysUserMapper userMapper;
    private final JwtUtil jwtUtil;
    private final StringRedisTemplate redis;
    private final SessionService sessionService;
    private final MeterRegistry meterRegistry;
    private final MetricsRegistry metricsRegistry;
    private final UserRolePermissionService rbac;

    public AuthServiceImpl(SysUserMapper userMapper, JwtUtil jwtUtil, StringRedisTemplate redis,
                           SessionService sessionService,
                           MeterRegistry meterRegistry, MetricsRegistry metricsRegistry,
                           UserRolePermissionService rbac) {
        this.userMapper = userMapper;
        this.jwtUtil = jwtUtil;
        this.redis = redis;
        this.sessionService = sessionService;
        this.meterRegistry = meterRegistry;
        this.metricsRegistry = metricsRegistry;
        this.rbac = rbac;
    }

    @Override
    public LoginResult loginWithPassword(LoginRequest req, String clientIp, String userAgent) {
        String failKey = "auth:fail:" + req.getUsername();
        String currentFails = redis.opsForValue().get(failKey);
        if (currentFails != null && Integer.parseInt(currentFails) >= MAX_FAILS) {
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "locked").increment();
            metricsRegistry.incrAuthLogin("fail");
            throw new BusinessException(ResultCode.AUTH_LOCKED_TOO_MANY_ATTEMPTS);
        }

        SysUser user = userMapper.selectOne(new QueryWrapper<SysUser>().eq("username", req.getUsername()));
        if (user == null || user.getPasswordHash() == null
            || !BCrypt.checkpw(req.getPassword(), user.getPasswordHash())) {
            recordFail(failKey);
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "bad_credentials").increment();
            metricsRegistry.incrAuthLogin("fail");
            throw new BusinessException(ResultCode.AUTH_BAD_CREDENTIALS);
        }

        if ("FROZEN".equals(user.getStatus())) {
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "frozen").increment();
            metricsRegistry.incrAuthLogin("fail");
            throw new BusinessException(ResultCode.AUTH_ACCOUNT_FROZEN);
        }
        if ("EXPIRED".equals(user.getStatus())) {
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "expired").increment();
            metricsRegistry.incrAuthLogin("fail");
            throw new BusinessException(ResultCode.AUTH_ACCOUNT_EXPIRED);
        }

        if ("TEMP".equals(user.getUserType()) && user.getExpiresAt() != null
            && user.getExpiresAt().isBefore(LocalDateTime.now())) {
            user.setStatus("EXPIRED");
            user.setExpiredAt(LocalDateTime.now());
            userMapper.updateById(user);
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "temp_expired").increment();
            metricsRegistry.incrAuthLogin("fail");
            throw new BusinessException(ResultCode.AUTH_ACCOUNT_EXPIRED);
        }

        redis.delete(failKey);
        user.setLastLoginAt(LocalDateTime.now());
        user.setLastLoginIp(clientIp);
        userMapper.updateById(user);

        meterRegistry.counter("shopifyhub.auth.login", "result", "success").increment();
        metricsRegistry.incrAuthLogin("success");
        return issue(user, clientIp, userAgent);
    }

    @Override
    public void logout(String accessToken, Long userId, String sid) {
        if (accessToken != null && !accessToken.isBlank()) {
            redis.opsForValue().set("auth:blacklist:" + accessToken, "1", BLACKLIST_TTL);
        }
        if (userId != null && sid != null) {
            sessionService.remove(userId, sid);
        }
    }

    @Override
    public LoginResult refresh(String refreshToken, String clientIp, String userAgent) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Claims c;
        try {
            c = jwtUtil.parse(refreshToken);
        } catch (JwtException | IllegalStateException | IllegalArgumentException e) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "refresh token 无效");
        }
        if (!"refresh".equals(c.get("typ", String.class))) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "token 类型错误");
        }
        Long userId = Long.parseLong(c.getSubject());
        String oldSid = c.get("sid", String.class);
        if (oldSid == null || !sessionService.exists(userId, oldSid)) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "session 已失效");
        }
        SysUser user = userMapper.selectById(userId);
        if (user == null) {
            sessionService.remove(userId, oldSid);
            throw new BusinessException(ResultCode.UNAUTHORIZED, "用户不存在");
        }
        if ("FROZEN".equals(user.getStatus()) || "EXPIRED".equals(user.getStatus())) {
            sessionService.remove(userId, oldSid);
            throw new BusinessException(ResultCode.AUTH_ACCOUNT_FROZEN);
        }
        // rotate：删旧 sid，发新 sid
        sessionService.remove(userId, oldSid);
        return issue(user, clientIp, userAgent);
    }

    @Override
    public List<SessionView> listSessions(long userId, String currentSid) {
        List<SessionInfo> raw = sessionService.list(userId);
        List<SessionView> out = new ArrayList<>(raw.size());
        for (SessionInfo s : raw) out.add(new SessionView(s, s.sid().equals(currentSid)));
        return out;
    }

    @Override
    public long kickOthers(long userId, String currentSid) {
        return sessionService.removeOthers(userId, currentSid);
    }

    /** 公共发 token 路径（登录 + refresh 共用）：建 session、签 access/refresh。 */
    private LoginResult issue(SysUser user, String clientIp, String userAgent) {
        String sid = sessionService.newSid();
        Map<String, Object> claims = new HashMap<>();
        claims.put("ut", user.getUserType());
        claims.put("tid", user.getDefaultTenantId());

        String access, refresh;
        try {
            access = jwtUtil.issueAccess(user.getId(), user.getUsername(), sid, claims);
            refresh = jwtUtil.issueRefresh(user.getId(), user.getUsername(), sid);
        } catch (IllegalStateException e) {
            log.warn("JWT keys not configured, returning stub tokens. Configure JWT_PRIVATE_KEY/JWT_PUBLIC_KEY.");
            access = "stub-access-" + user.getId();
            refresh = "stub-refresh-" + user.getId();
        }

        sessionService.create(user.getId(), sid, userAgent, clientIp);

        LoginResponse resp = new LoginResponse(
            user.getId(),
            user.getUsername(),
            user.getEmployeeNo(),
            user.getUserType(),
            Boolean.TRUE.equals(user.getPasswordMustChange()),
            access,
            rbac.loadRoles(user.getId()),
            rbac.loadPermissions(user.getId())
        );
        return new LoginResult(resp, refresh);
    }

    private void recordFail(String key) {
        Long fails = redis.opsForValue().increment(key);
        if (fails != null && fails == 1L) redis.expire(key, FAIL_WINDOW);
    }
}
