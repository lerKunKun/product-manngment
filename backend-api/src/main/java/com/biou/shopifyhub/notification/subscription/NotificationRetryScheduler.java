package com.biou.shopifyhub.notification.subscription;

import com.biou.shopifyhub.auth.dingtalk.DingTalkApiClient;
import com.biou.shopifyhub.notification.NotificationEventCode;
import com.biou.shopifyhub.notification.subscription.entity.NotificationLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;

/**
 * W4-NTF-04 通知失败重试。
 *
 * <p>每分钟扫一批 status=FAILED 且 attempt_count < max 且 next_retry_at <= NOW() 的记录重试。
 * 达到 max（初次 + 3 次重试 = 4 次）后保持 FAILED 不再重试，并触发一次 HIGH_RISK_OP / FAILED 告警
 * 给 fallback 用户（Redis 1h dedupe，避免风暴）。
 */
@Component
public class NotificationRetryScheduler {

    private static final Logger log = LoggerFactory.getLogger(NotificationRetryScheduler.class);
    private static final String DEDUPE_KEY = "ntf:fail-alert:";

    private final NotificationSendService sendService;
    private final DingTalkApiClient mainDingTalk;
    private final StringRedisTemplate redis;

    @Value("${ops.notify-fallback-user-ding-id:}")
    private String fallbackDingId;

    public NotificationRetryScheduler(NotificationSendService sendService,
                                      DingTalkApiClient mainDingTalk,
                                      StringRedisTemplate redis) {
        this.sendService = sendService;
        this.mainDingTalk = mainDingTalk;
        this.redis = redis;
    }

    @Scheduled(cron = "${ops.ntf-retry-cron:0 */1 * * * *}")
    public void retryBatch() {
        List<NotificationLog> batch;
        try {
            batch = sendService.findReadyForRetry(50);
        } catch (Exception e) {
            log.error("[ntf-retry-scan] failed", e);
            return;
        }
        if (batch.isEmpty()) return;

        int ok = 0, again = 0, exhausted = 0;
        for (NotificationLog row : batch) {
            int next = (row.getAttemptCount() == null ? 0 : row.getAttemptCount()) + 1;
            try {
                if (sendService.retry(row)) {
                    ok++;
                } else if (next >= NotificationSendService.maxAttempts()) {
                    exhausted++;
                    alertExhausted(row);
                } else {
                    again++;
                }
            } catch (Exception e) {
                log.error("[ntf-retry] id={} failed", row.getId(), e);
            }
        }
        log.info("[ntf-retry] scanned={} ok={} again={} exhausted={}",
            batch.size(), ok, again, exhausted);
    }

    private void alertExhausted(NotificationLog row) {
        if (fallbackDingId == null || fallbackDingId.isBlank()) {
            log.warn("[ntf-retry-exhausted] no fallback dingId configured; logId={} event={} ch={}",
                row.getId(), row.getEventCode(), row.getChannel());
            return;
        }
        String dedupe = DEDUPE_KEY + row.getEventCode() + ":" + row.getChannel();
        Boolean fresh = redis.opsForValue().setIfAbsent(dedupe, "1", Duration.ofHours(1));
        if (Boolean.TRUE.equals(fresh)) {
            String msg = "[" + NotificationEventCode.HIGH_RISK_OP + "] 通知发送 4 次仍失败：event="
                + row.getEventCode() + " ch=" + row.getChannel()
                + " user=" + row.getUserId() + " logId=" + row.getId()
                + " err=" + (row.getErrorMsg() == null ? "?" : row.getErrorMsg());
            try {
                mainDingTalk.sendTextToUser(fallbackDingId, msg);
            } catch (Exception e) {
                log.error("[ntf-retry-exhausted] alert send failed", e);
            }
        }
    }
}
