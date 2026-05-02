package com.biou.shopifyhub.auth.password;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.auth.password.entity.PasswordResetToken;
import com.biou.shopifyhub.auth.password.mapper.PasswordResetTokenMapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.notification.EmailService;
import com.biou.shopifyhub.notification.EmailTemplateRenderer;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;

/**
 * W4-MAIL-03：忘记密码 / 重置密码。
 *
 * 安全要点：
 *  - {@code request} 永远返回 200（不泄露用户存在性）。
 *  - token 32 字节随机 + Base64URL；DB 只存 SHA-256；30min TTL；一次性。
 *  - 限流：同一 email 5 分钟最多 1 次（Redis SETNX）。
 *  - {@code confirm} 走 BCrypt encode + 清登录失败计数 + 标 token used。
 *  - 两个端点都不需要 JWT（{@link com.biou.shopifyhub.core.SecurityConfig} 中放行）。
 */
@RestController
@RequestMapping("/auth/password-reset")
public class PasswordResetController {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetController.class);
    private static final Duration TOKEN_TTL = Duration.ofMinutes(30);
    private static final Duration RATE_LIMIT_TTL = Duration.ofMinutes(5);
    private static final SecureRandom RNG = new SecureRandom();

    private final SysUserMapper userMapper;
    private final PasswordResetTokenMapper tokenMapper;
    private final EmailService emailService;
    private final EmailTemplateRenderer renderer;
    private final StringRedisTemplate redis;

    @Value("${app.base-url:http://localhost:3000}")
    private String appBaseUrl;

    @Value("${app.brand-name:Biou x Shopify Control Center}")
    private String brandName;

    public PasswordResetController(SysUserMapper userMapper,
                                   PasswordResetTokenMapper tokenMapper,
                                   EmailService emailService,
                                   EmailTemplateRenderer renderer,
                                   StringRedisTemplate redis) {
        this.userMapper = userMapper;
        this.tokenMapper = tokenMapper;
        this.emailService = emailService;
        this.renderer = renderer;
        this.redis = redis;
    }

    @PostMapping("/request")
    public Result<Void> request(@RequestBody PasswordResetRequest req, HttpServletRequest http) {
        String email = req.email() == null ? null : req.email().trim().toLowerCase();
        if (email == null || email.isBlank()) {
            // 即便空也不暴露，但参数本身错误可以提示
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "email 必填");
        }

        // 限流：同 email 5min 1 次
        String lockKey = "pwd_reset:lock:" + email;
        Boolean acquired = redis.opsForValue().setIfAbsent(lockKey, "1", RATE_LIMIT_TTL);
        if (Boolean.FALSE.equals(acquired)) {
            log.info("[pwd-reset-rate-limited] email={}", email);
            // 仍返回 200，避免侧信道
            return Result.ok();
        }

        SysUser u = userMapper.selectOne(new LambdaQueryWrapper<SysUser>().eq(SysUser::getEmail, email));
        if (u == null || !"ACTIVE".equals(u.getStatus())) {
            log.info("[pwd-reset-noop] email={} userExists={}", email, u != null);
            return Result.ok(); // 不泄露
        }

        // 生成 token
        byte[] raw = new byte[32];
        RNG.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        String tokenHash = sha256Hex(token);

        PasswordResetToken row = new PasswordResetToken();
        row.setUserId(u.getId());
        row.setTokenHash(tokenHash);
        row.setEmail(email);
        row.setExpiresAt(LocalDateTime.now().plus(TOKEN_TTL));
        row.setRequestedIp(extractIp(http));
        tokenMapper.insert(row);

        String resetUrl = appBaseUrl + "/reset-password?token=" + token;
        try {
            String html = renderer.renderPasswordReset(new EmailTemplateRenderer.PasswordResetCtx(
                brandName, u.getUsername(), resetUrl, row.getRequestedIp()
            ));
            emailService.sendHtml(email, "[" + brandName + "] 重置密码", html);
        } catch (Exception e) {
            log.warn("[pwd-reset-mail-fail] email={} err={}", email, e.getMessage());
        }
        return Result.ok();
    }

    @PostMapping("/confirm")
    public Result<Void> confirm(@RequestBody PasswordResetConfirm req) {
        if (req.token() == null || req.token().isBlank() || req.newPassword() == null || req.newPassword().length() < 8) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "token 必填，密码至少 8 位");
        }
        String hash = sha256Hex(req.token());
        PasswordResetToken row = tokenMapper.selectOne(
            new LambdaQueryWrapper<PasswordResetToken>().eq(PasswordResetToken::getTokenHash, hash)
        );
        if (row == null) throw new BusinessException(ResultCode.BAD_REQUEST, "token 无效");
        if (row.getUsedAt() != null) throw new BusinessException(ResultCode.BAD_REQUEST, "token 已使用");
        if (row.getExpiresAt().isBefore(LocalDateTime.now())) throw new BusinessException(ResultCode.BAD_REQUEST, "token 已过期");

        SysUser u = userMapper.selectById(row.getUserId());
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        if (!"ACTIVE".equals(u.getStatus())) throw new BusinessException(ResultCode.BAD_REQUEST, "账号状态异常");

        // 改密码 + 清失败计数 + 标 token used
        u.setPasswordHash(BCrypt.hashpw(req.newPassword(), BCrypt.gensalt(10)));
        u.setPasswordMustChange(false);
        userMapper.updateById(u);

        redis.delete("auth:fail:" + u.getUsername());

        row.setUsedAt(LocalDateTime.now());
        tokenMapper.updateById(row);

        // 让该用户其它未用 token 立即失效
        List<PasswordResetToken> others = tokenMapper.selectList(
            new LambdaQueryWrapper<PasswordResetToken>()
                .eq(PasswordResetToken::getUserId, u.getId())
                .isNull(PasswordResetToken::getUsedAt)
                .ne(PasswordResetToken::getId, row.getId())
        );
        LocalDateTime now = LocalDateTime.now();
        for (PasswordResetToken o : others) {
            o.setUsedAt(now);
            tokenMapper.updateById(o);
        }

        log.info("[pwd-reset-done] userId={} username={}", u.getId(), u.getUsername());
        return Result.ok();
    }

    private static String sha256Hex(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(h.length * 2);
            for (byte b : h) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private static String extractIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        return req.getRemoteAddr();
    }

    public record PasswordResetRequest(String email) {}
    public record PasswordResetConfirm(String token, String newPassword) {}
}
