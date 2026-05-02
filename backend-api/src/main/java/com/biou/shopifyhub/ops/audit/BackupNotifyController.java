package com.biou.shopifyhub.ops.audit;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.YearMonth;

/**
 * W4-OPS-04 备份失败钉钉告警接收端点 + 手动触发审计归档。
 *
 * <p>路径仅 loopback 可访问（{@link #assertLoopback}）；同时 SecurityConfig 把 /ops/backup/**
 * permitAll，避免 cron shell 调用时还要带 JWT。
 */
@RestController
@RequestMapping("/ops/backup")
public class BackupNotifyController {

    private static final Logger log = LoggerFactory.getLogger(BackupNotifyController.class);

    private final NotificationDispatcher notifier;
    private final AuditArchiveScheduler auditArchive;

    @Value("${ops.notify-fallback-user-id:0}")
    private Long fallbackUserId;

    public BackupNotifyController(NotificationDispatcher notifier,
                                  AuditArchiveScheduler auditArchive) {
        this.notifier = notifier;
        this.auditArchive = auditArchive;
    }

    @PostMapping("/notify-fail")
    public Result<Void> notifyFail(@RequestBody NotifyFailBody body, HttpServletRequest req) {
        assertLoopback(req);
        if (fallbackUserId == null || fallbackUserId <= 0) {
            log.warn("[backup-notify] fallbackUserId not configured; received {} {}", body.date(), body.reason());
            return Result.ok();
        }
        String text = "[" + NotificationEventCode.BACKUP_FAIL + "] 备份失败 "
            + body.date() + "：" + body.reason();
        notifier.notifyUser(fallbackUserId, NotificationEventCode.BACKUP_FAIL,
            "备份任务失败 " + body.date(), text, null);
        return Result.ok();
    }

    @PostMapping("/notify-success")
    public Result<Void> notifySuccess(@RequestBody NotifySuccessBody body, HttpServletRequest req) {
        assertLoopback(req);
        log.info("[backup-success] date={} bytes={} sha={}", body.date(), body.bytes(), body.sha256());
        return Result.ok();
    }

    @PostMapping("/audit-archive/run")
    public Result<Object> runAuditArchive(@RequestBody(required = false) ArchiveRunBody body,
                                          HttpServletRequest req) {
        assertLoopback(req);
        YearMonth month = body == null || body.month() == null
            ? YearMonth.now().minusMonths(2)
            : YearMonth.parse(body.month());
        return Result.ok(auditArchive.archive(month));
    }

    private void assertLoopback(HttpServletRequest req) {
        String addr = req.getRemoteAddr();
        boolean local = "127.0.0.1".equals(addr) || "::1".equals(addr) || "0:0:0:0:0:0:0:1".equals(addr);
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String first = xff.split(",")[0].trim();
            local = local && ("127.0.0.1".equals(first) || "::1".equals(first));
        }
        if (!local) {
            throw new BusinessException(ResultCode.FORBIDDEN, "/ops/backup/** 仅 loopback 可调用");
        }
    }

    public record NotifyFailBody(LocalDate date, String reason) {}
    public record NotifySuccessBody(LocalDate date, Long bytes, String sha256) {}
    public record ArchiveRunBody(String month) {}
}
