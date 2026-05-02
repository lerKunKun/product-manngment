package com.biou.shopifyhub.rbac.datascope;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.core.entity.SysDataScope;
import com.biou.shopifyhub.core.mapper.SysDataScopeMapper;
import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * W3-DS-03：跨公司授权 24h 提醒 + 每天 00:05 硬过期。
 *
 * <p>warnExpiring：每小时整点扫 {@code cross_company=1 AND status='ACTIVE' AND
 * expires_at BETWEEN NOW() AND NOW()+24h AND expiring_notified_at IS NULL}，
 * 逐条调 {@link NotificationDispatcher#notifyUser} 发钉钉 + 邮件，
 * 然后写 {@code expiring_notified_at=NOW()} 去重。
 *
 * <p>hardExpire：每天 00:05 把已过期的跨公司授权切 REVOKED + 写 revoked_at；
 * DataScopeInterceptor 仅匹配 status='ACTIVE'，自动屏蔽。
 */
@Component
public class CrossAuthExpiryScheduler {

    private static final Logger log = LoggerFactory.getLogger(CrossAuthExpiryScheduler.class);
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final SysDataScopeMapper scopeMapper;
    private final NotificationDispatcher notifier;

    public CrossAuthExpiryScheduler(SysDataScopeMapper scopeMapper, NotificationDispatcher notifier) {
        this.scopeMapper = scopeMapper;
        this.notifier = notifier;
    }

    /** 整点：扫 24h 内即将过期的跨公司授权 → 钉钉/邮件提醒（idempotent via expiring_notified_at）。 */
    @Scheduled(cron = "${rbac.cross-auth.expiry-warn-cron:0 0 * * * *}")
    public void warnExpiring() {
        try {
            LocalDateTime now = LocalDateTime.now();
            LocalDateTime window = now.plusHours(24);
            List<SysDataScope> due = scopeMapper.selectList(
                new LambdaQueryWrapper<SysDataScope>()
                    .eq(SysDataScope::getCrossCompany, true)
                    .eq(SysDataScope::getStatus, "ACTIVE")
                    .ge(SysDataScope::getExpiresAt, now)
                    .lt(SysDataScope::getExpiresAt, window)
                    .isNull(SysDataScope::getExpiringNotifiedAt)
            );
            int notified = 0;
            for (SysDataScope ds : due) {
                try {
                    String expStr = ds.getExpiresAt() == null ? "" : ds.getExpiresAt().format(FMT);
                    String subject = "[跨公司授权] 24 小时内到期提醒";
                    String bodyText = String.format(
                        "您的跨公司授权将在 %s 到期。授权 ID=%d，scopeType=%s，scopeId=%d，授权人 userId=%s，授权方公司 id=%s。请确认是否需要续期；到期后系统将自动撤销。",
                        expStr, ds.getId(), ds.getScopeType(), ds.getScopeId(),
                        String.valueOf(ds.getGrantedBy()), String.valueOf(ds.getGranterCompanyId())
                    );
                    String bodyHtml = "<p>您的跨公司授权将在 <b>" + expStr + "</b> 到期。</p>"
                        + "<ul>"
                        + "<li>授权 ID：" + ds.getId() + "</li>"
                        + "<li>scopeType：" + ds.getScopeType() + "</li>"
                        + "<li>scopeId：" + ds.getScopeId() + "</li>"
                        + "<li>授权人 userId：" + ds.getGrantedBy() + "</li>"
                        + "<li>授权方公司 id：" + ds.getGranterCompanyId() + "</li>"
                        + "</ul>"
                        + "<p>到期后系统将自动撤销，如需续期请尽快联系授权方。</p>";
                    notifier.notifyUser(ds.getUserId(), NotificationEventCode.CROSS_AUTH_EXPIRING,
                        subject, bodyText, bodyHtml);
                    ds.setExpiringNotifiedAt(now);
                    scopeMapper.updateById(ds);
                    notified++;
                } catch (Exception e) {
                    log.warn("[cross-auth-warn] notify failed scopeId={} err={}", ds.getId(), e.getMessage());
                }
            }
            if (notified > 0) {
                log.info("[cross-auth-warn] notified {} grants expiring within 24h", notified);
            }
        } catch (Exception e) {
            log.error("[cross-auth-warn] failed: {}", e.getMessage(), e);
        }
    }

    /** 每天 00:05：把已过期的跨公司授权硬切 REVOKED。 */
    @Scheduled(cron = "${rbac.cross-auth.expire-cron:0 5 0 * * *}")
    public void hardExpire() {
        try {
            LocalDateTime now = LocalDateTime.now();
            List<SysDataScope> expired = scopeMapper.selectList(
                new LambdaQueryWrapper<SysDataScope>()
                    .eq(SysDataScope::getCrossCompany, true)
                    .eq(SysDataScope::getStatus, "ACTIVE")
                    .lt(SysDataScope::getExpiresAt, now)
            );
            for (SysDataScope ds : expired) {
                ds.setStatus("REVOKED");
                ds.setRevokedAt(now);
                scopeMapper.updateById(ds);
            }
            if (!expired.isEmpty()) {
                log.info("[cross-auth-expire] hard-revoked {} grants past expiry", expired.size());
            }
        } catch (Exception e) {
            log.error("[cross-auth-expire] failed: {}", e.getMessage(), e);
        }
    }
}
