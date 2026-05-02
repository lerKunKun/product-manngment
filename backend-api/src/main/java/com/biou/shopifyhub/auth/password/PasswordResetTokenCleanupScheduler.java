package com.biou.shopifyhub.auth.password;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.auth.password.entity.PasswordResetToken;
import com.biou.shopifyhub.auth.password.mapper.PasswordResetTokenMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * W4-MAIL-03：每天 02:00 清理已使用 / 已过期 7 天前的 password_reset_token。
 */
@Component
public class PasswordResetTokenCleanupScheduler {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetTokenCleanupScheduler.class);

    private final PasswordResetTokenMapper mapper;

    public PasswordResetTokenCleanupScheduler(PasswordResetTokenMapper mapper) {
        this.mapper = mapper;
    }

    @Scheduled(cron = "${password-reset.cleanup-cron:0 0 2 * * *}")
    public void cleanup() {
        try {
            LocalDateTime cutoff = LocalDateTime.now().minusDays(7);
            int n = mapper.delete(new LambdaQueryWrapper<PasswordResetToken>()
                .and(w -> w
                    .lt(PasswordResetToken::getUsedAt, cutoff)
                    .or()
                    .lt(PasswordResetToken::getExpiresAt, cutoff)
                )
            );
            if (n > 0) log.info("[pwd-reset-cleanup] purged {} stale tokens", n);
        } catch (Exception e) {
            log.error("[pwd-reset-cleanup] failed: {}", e.getMessage(), e);
        }
    }
}
