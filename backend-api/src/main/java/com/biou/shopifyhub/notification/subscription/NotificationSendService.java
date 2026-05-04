package com.biou.shopifyhub.notification.subscription;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.metrics.MetricsRegistry;
import com.biou.shopifyhub.notification.EmailService;
import com.biou.shopifyhub.notification.inapp.InappBridge;
import com.biou.shopifyhub.notification.subscription.entity.NotificationLog;
import com.biou.shopifyhub.notification.subscription.mapper.NotificationLogMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * W4-NTF-04 通知发送主入口。
 *
 * <p>流程：
 *  1. 拉用户订阅（含默认补齐）
 *  2. 按订阅 channels 各自落 PENDING notification_log
 *  3. 逐通道调底层（DINGTALK / EMAIL / INAPP）
 *  4. 成功改 SENT；失败改 FAILED + attempt_count++ + next_retry_at（指数退避 60s/300s/900s）
 *
 * <p>不抛异常：所有异常都收敛到 log + DB 状态，避免 dispatcher 链路被一个 channel 拖死。
 */
@Service
public class NotificationSendService {

    private static final Logger log = LoggerFactory.getLogger(NotificationSendService.class);
    private static final long[] BACKOFF_SECONDS = {60, 300, 900};

    private final SubscriptionService subscriptionService;
    private final SysUserMapper userMapper;
    private final NotificationLogMapper logMapper;
    private final MultiCorpDingTalkResolver dingResolver;
    private final EmailService emailService;
    private final InappBridge inappBridge;
    private final MetricsRegistry metricsRegistry;

    /** EMAIL 通道总开关：dev 没配 SMTP 时设 false 可避免每条失败通知都跑去尝试连 SMTP。 */
    @Value("${notification.email.enabled:true}")
    private boolean emailEnabled;

    /** DINGTALK 通道总开关：dev 没钉钉配置时同理可关。 */
    @Value("${notification.dingtalk.enabled:true}")
    private boolean dingtalkEnabled;

    @Autowired
    public NotificationSendService(SubscriptionService subscriptionService,
                                   SysUserMapper userMapper,
                                   NotificationLogMapper logMapper,
                                   MultiCorpDingTalkResolver dingResolver,
                                   EmailService emailService,
                                   InappBridge inappBridge,
                                   MetricsRegistry metricsRegistry) {
        this.subscriptionService = subscriptionService;
        this.userMapper = userMapper;
        this.logMapper = logMapper;
        this.dingResolver = dingResolver;
        this.emailService = emailService;
        this.inappBridge = inappBridge;
        this.metricsRegistry = metricsRegistry;
    }

    private boolean channelDisabled(String ch) {
        return ("EMAIL".equals(ch) && !emailEnabled)
            || ("DINGTALK".equals(ch) && !dingtalkEnabled);
    }

    /**
     * 统一派发入口。NotificationDispatcher 改造后委托给本方法。
     */
    public void dispatch(Long userId, String eventCode, String subject, String bodyText, String bodyHtml) {
        if (userId == null || eventCode == null) {
            log.warn("[ntf-skip] userId/eventCode null event={}", eventCode);
            return;
        }
        SysUser u = userMapper.selectById(userId);
        if (u == null) {
            log.warn("[ntf-skip] user not found id={} event={}", userId, eventCode);
            return;
        }

        for (String ch : List.of("DINGTALK", "EMAIL", "INAPP")) {
            if (!subscriptionService.isSubscribed(userId, eventCode, ch)) {
                continue;
            }
            if (channelDisabled(ch)) {
                log.debug("[ntf-skip] channel disabled by config ch={} event={}", ch, eventCode);
                continue;
            }
            NotificationLog row = insertPending(u, eventCode, ch, subject, bodyText);
            try {
                String err = sendOne(u, ch, subject, bodyText, bodyHtml);
                if (err == null) {
                    markSent(row.getId());
                } else {
                    markFailed(row.getId(), err, 1);
                }
            } catch (Exception e) {
                // 底层失败已记入 notification_log；用 WARN + 短消息，不再 dump stack 污染日志
                log.warn("[ntf-send] event={} user={} ch={} failed: {}",
                    eventCode, userId, ch, e.getMessage());
                markFailed(row.getId(), e.getMessage(), 1);
            }
        }
    }

    /**
     * 重试调度器入口：按 logId 重试一次。返回 true 已最终成功，false 仍失败（attempt 已 +1）。
     */
    public boolean retry(NotificationLog row) {
        SysUser u = userMapper.selectById(row.getUserId());
        if (u == null) {
            markSkipped(row.getId(), "user vanished");
            return false;
        }
        if (channelDisabled(row.getChannel())) {
            // 配置已关，没必要继续重试，让它停在 SKIPPED
            markSkipped(row.getId(), "channel disabled by config");
            return false;
        }
        int next = row.getAttemptCount() == null ? 1 : row.getAttemptCount() + 1;
        try {
            String err = sendOne(u, row.getChannel(), row.getSubject(), row.getBodyText(), null);
            if (err == null) {
                markSent(row.getId());
                return true;
            }
            markFailed(row.getId(), err, next);
            return false;
        } catch (Exception e) {
            log.warn("[ntf-retry] logId={} ch={} failed: {}",
                row.getId(), row.getChannel(), e.getMessage());
            markFailed(row.getId(), e.getMessage(), next);
            return false;
        }
    }

    static long backoffSecondsForAttempt(int attempt) {
        if (attempt <= 0) return BACKOFF_SECONDS[0];
        int idx = Math.min(attempt - 1, BACKOFF_SECONDS.length - 1);
        return BACKOFF_SECONDS[idx];
    }

    static int maxAttempts() {
        return BACKOFF_SECONDS.length + 1; // 初次 + 3 次重试 = 4
    }

    private String sendOne(SysUser u, String channel, String subject, String bodyText, String bodyHtml) {
        switch (channel) {
            case "DINGTALK" -> {
                boolean ok = dingResolver.sendTextToUser(u.getId(), bodyText != null ? bodyText : subject);
                return ok ? null : "DingTalk send returned false (token invalid / userId missing / errcode!=0)";
            }
            case "EMAIL" -> {
                if (u.getEmail() == null || u.getEmail().isBlank()) return "user email empty";
                emailService.sendHtml(u.getEmail(), subject,
                    bodyHtml != null ? bodyHtml : "<pre>" + escape(bodyText) + "</pre>");
                return null;
            }
            case "INAPP" -> {
                inappBridge.send(u.getId(), null, subject, bodyText, bodyHtml, null);
                return null;
            }
            default -> {
                return "unknown channel " + channel;
            }
        }
    }

    private NotificationLog insertPending(SysUser u, String eventCode, String channel, String subject, String bodyText) {
        NotificationLog l = new NotificationLog();
        l.setTenantId(u.getDefaultTenantId());
        l.setUserId(u.getId());
        l.setEventCode(eventCode);
        l.setChannel(channel);
        l.setSubject(snip(subject, 256));
        l.setBodyText(snip(bodyText, 4000));
        l.setStatus("PENDING");
        l.setAttemptCount(0);
        logMapper.insert(l);
        return l;
    }

    private void markSent(Long id) {
        NotificationLog upd = new NotificationLog();
        upd.setId(id);
        upd.setStatus("SENT");
        upd.setSentAt(LocalDateTime.now());
        logMapper.updateById(upd);
        metricsRegistry.incrNotificationSend("sent");
    }

    private void markFailed(Long id, String err, int attempt) {
        NotificationLog upd = new NotificationLog();
        upd.setId(id);
        upd.setStatus("FAILED");
        upd.setErrorMsg(snip(err, 1024));
        upd.setAttemptCount(attempt);
        if (attempt < maxAttempts()) {
            upd.setNextRetryAt(LocalDateTime.now().plusSeconds(backoffSecondsForAttempt(attempt)));
        } else {
            upd.setNextRetryAt(null);
        }
        logMapper.updateById(upd);
        metricsRegistry.incrNotificationSend("failed");
    }

    private void markSkipped(Long id, String reason) {
        NotificationLog upd = new NotificationLog();
        upd.setId(id);
        upd.setStatus("SKIPPED");
        upd.setErrorMsg(snip(reason, 1024));
        logMapper.updateById(upd);
        metricsRegistry.incrNotificationSend("skipped");
    }

    public List<NotificationLog> findReadyForRetry(int limit) {
        return logMapper.selectList(new LambdaQueryWrapper<NotificationLog>()
            .eq(NotificationLog::getStatus, "FAILED")
            .lt(NotificationLog::getAttemptCount, maxAttempts())
            .le(NotificationLog::getNextRetryAt, LocalDateTime.now())
            .orderByAsc(NotificationLog::getNextRetryAt)
            .last("LIMIT " + Math.max(1, limit)));
    }

    private static String snip(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
