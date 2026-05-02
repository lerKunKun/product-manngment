package com.biou.shopifyhub.core.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tags;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * T1 关键指标暴露入口。所有 counter / gauge 用 ConcurrentHashMap 缓存，避免重复注册导致内存泄漏。
 *
 * <p>Counter 名（{@code shopifyhub_*_total}）：
 *  - shopifyhub_r2_upload_total{result=success|fail}
 *  - shopifyhub_notification_send_total{result=sent|failed|skipped}
 *  - shopifyhub_auth_login_total{result=success|fail}
 *
 * <p>Gauge：
 *  - shopifyhub_backup_last_success_seconds
 *  - shopifyhub_audit_archive_last_success_seconds
 *  - shopifyhub_approval_pending_max_age_seconds（在 {@link ApprovalMetricsExporter} 中刷新）
 */
@Component
public class MetricsRegistry {

    private final MeterRegistry registry;
    private final ConcurrentHashMap<String, Counter> counters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AtomicLong> gauges = new ConcurrentHashMap<>();

    public MetricsRegistry(MeterRegistry registry) {
        this.registry = registry;
    }

    public void incrR2Upload(String result) {
        counter("shopifyhub_r2_upload_total", "result", result).increment();
    }

    public void incrNotificationSend(String result) {
        counter("shopifyhub_notification_send_total", "result", result).increment();
    }

    public void incrAuthLogin(String result) {
        counter("shopifyhub_auth_login_total", "result", result).increment();
    }

    public void setBackupLastSuccess(long unixSeconds) {
        gauge("shopifyhub_backup_last_success_seconds").set(unixSeconds);
    }

    public void setAuditArchiveLastSuccess(long unixSeconds) {
        gauge("shopifyhub_audit_archive_last_success_seconds").set(unixSeconds);
    }

    /** 返回 backup 上次成功时间（unix s）；未 set 返 null。 */
    public Long getBackupLastSuccessAt() {
        AtomicLong h = gauges.get("shopifyhub_backup_last_success_seconds");
        if (h == null) return null;
        long v = h.get();
        return v == 0L ? null : v;
    }

    /** 返回审计归档上次成功时间（unix s）；未 set 返 null。 */
    public Long getAuditArchiveLastSuccessAt() {
        AtomicLong h = gauges.get("shopifyhub_audit_archive_last_success_seconds");
        if (h == null) return null;
        long v = h.get();
        return v == 0L ? null : v;
    }

    private Counter counter(String name, String tagKey, String tagVal) {
        String key = name + "|" + tagKey + "=" + tagVal;
        return counters.computeIfAbsent(key, k ->
            Counter.builder(name).tags(Tags.of(tagKey, tagVal)).register(registry));
    }

    private AtomicLong gauge(String name) {
        return gauges.computeIfAbsent(name, k -> {
            AtomicLong holder = new AtomicLong(0);
            registry.gauge(name, holder);
            return holder;
        });
    }
}
