package com.biou.shopifyhub.invitation.scheduler;

import com.biou.shopifyhub.invitation.service.InvitationService;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class InvitationExpiryScheduler {

    private static final Logger log = LoggerFactory.getLogger(InvitationExpiryScheduler.class);

    private final InvitationService service;
    private final com.biou.shopifyhub.invitation.service.impl.InvitationServiceImpl impl;
    private final MeterRegistry meterRegistry;

    public InvitationExpiryScheduler(
        InvitationService service,
        com.biou.shopifyhub.invitation.service.impl.InvitationServiceImpl impl,
        MeterRegistry meterRegistry
    ) {
        this.service = service;
        this.impl = impl;
        this.meterRegistry = meterRegistry;
    }

    /**
     * 每小时巡检：到期临时账号切 EXPIRED + 收回数据范围。
     * cron 由 application-dev.yml 注入，默认 0 * * * * *（每小时整点）。
     */
    @Scheduled(cron = "${invitation.expiry-check-cron:0 0 * * * *}")
    public void sweepExpired() {
        try {
            int n = service.sweepExpired();
            if (n > 0) {
                meterRegistry.counter("shopifyhub.invitation.expired").increment(n);
                log.info("Invitation expiry sweep: {} accounts revoked.", n);
            }
        } catch (Exception e) {
            log.error("Invitation expiry sweep failed", e);
        }
    }

    /**
     * 每天 09:00 提醒 24h 内到期的临时账号。
     * Wave 1 完整化（W1-INV-08）：扫 expires_at ∈ (now, now+24h] 的账号 → 钉钉通知邀请人。
     */
    @Scheduled(cron = "${invitation.reminder-cron:0 0 9 * * *}")
    public void remind24h() {
        try {
            int n = impl.notifyExpiringSoon();
            if (n > 0) log.info("Invitation 24h reminder: notified {} accounts.", n);
        } catch (Exception e) {
            log.error("Invitation 24h reminder failed", e);
        }
    }
}
