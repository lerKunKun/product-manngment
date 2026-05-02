package com.biou.shopifyhub.auth.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.dto.LoginRequest;
import com.biou.shopifyhub.auth.dto.LoginResponse;
import com.biou.shopifyhub.auth.service.AuthService;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.security.JwtUtil;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
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
    private final MeterRegistry meterRegistry;

    public AuthServiceImpl(SysUserMapper userMapper, JwtUtil jwtUtil, StringRedisTemplate redis,
                           MeterRegistry meterRegistry) {
        this.userMapper = userMapper;
        this.jwtUtil = jwtUtil;
        this.redis = redis;
        this.meterRegistry = meterRegistry;
    }

    @Override
    public LoginResponse loginWithPassword(LoginRequest req, String clientIp) {
        String failKey = "auth:fail:" + req.getUsername();
        String currentFails = redis.opsForValue().get(failKey);
        if (currentFails != null && Integer.parseInt(currentFails) >= MAX_FAILS) {
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "locked").increment();
            throw new BusinessException(ResultCode.AUTH_LOCKED_TOO_MANY_ATTEMPTS);
        }

        SysUser user = userMapper.selectOne(new QueryWrapper<SysUser>().eq("username", req.getUsername()));
        if (user == null || user.getPasswordHash() == null
            || !BCrypt.checkpw(req.getPassword(), user.getPasswordHash())) {
            recordFail(failKey);
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "bad_credentials").increment();
            throw new BusinessException(ResultCode.AUTH_BAD_CREDENTIALS);
        }

        if ("FROZEN".equals(user.getStatus())) {
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "frozen").increment();
            throw new BusinessException(ResultCode.AUTH_ACCOUNT_FROZEN);
        }
        if ("EXPIRED".equals(user.getStatus())) {
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "expired").increment();
            throw new BusinessException(ResultCode.AUTH_ACCOUNT_EXPIRED);
        }

        // TEMP 账号过期检查
        if ("TEMP".equals(user.getUserType()) && user.getExpiresAt() != null
            && user.getExpiresAt().isBefore(LocalDateTime.now())) {
            user.setStatus("EXPIRED");
            user.setExpiredAt(LocalDateTime.now());
            userMapper.updateById(user);
            meterRegistry.counter("shopifyhub.auth.login", "result", "fail", "reason", "temp_expired").increment();
            throw new BusinessException(ResultCode.AUTH_ACCOUNT_EXPIRED);
        }

        // 清除失败计数
        redis.delete(failKey);

        // 更新登录信息
        user.setLastLoginAt(LocalDateTime.now());
        user.setLastLoginIp(clientIp);
        userMapper.updateById(user);

        // 签发 JWT
        Map<String, Object> claims = new HashMap<>();
        claims.put("ut", user.getUserType());
        claims.put("tid", user.getDefaultTenantId());

        String access, refresh;
        try {
            access = jwtUtil.issueAccess(user.getId(), user.getUsername(), claims);
            refresh = jwtUtil.issueRefresh(user.getId(), user.getUsername());
        } catch (IllegalStateException e) {
            // dev 阶段允许跳过 JWT（私钥未配），返回 stub token 便于联调
            log.warn("JWT keys not configured, returning stub tokens. Please configure JWT_PRIVATE_KEY/JWT_PUBLIC_KEY.");
            access = "stub-access-" + user.getId();
            refresh = "stub-refresh-" + user.getId();
        }

        meterRegistry.counter("shopifyhub.auth.login", "result", "success").increment();
        return new LoginResponse(
            user.getId(),
            user.getUsername(),
            user.getEmployeeNo(),
            user.getUserType(),
            Boolean.TRUE.equals(user.getPasswordMustChange()),
            access,
            refresh
        );
    }

    @Override
    public void logout(String accessToken) {
        if (accessToken == null || accessToken.isBlank()) return;
        redis.opsForValue().set("auth:blacklist:" + accessToken, "1", BLACKLIST_TTL);
    }

    private void recordFail(String key) {
        Long fails = redis.opsForValue().increment(key);
        if (fails != null && fails == 1L) redis.expire(key, FAIL_WINDOW);
    }
}
