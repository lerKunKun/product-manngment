package com.biou.shopifyhub.notification;

import com.biou.shopifyhub.notification.subscription.NotificationSendService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 通知调度入口（W4-NTF-04 完整化后）。
 *
 * <p>对外签名保持与 Wave 1 一致：所有现有调用方（InvitationServiceImpl / NewStore / Push / 等）
 * 不需要改动。内部委托给 {@link NotificationSendService}：
 *  - 按用户订阅过滤通道（DINGTALK / EMAIL / INAPP）
 *  - 多 corpId 钉钉发送 + 邮件 + 站内信
 *  - notification_log 持久化 + 失败重试调度（{@code NotificationRetryScheduler}）
 *
 * <p>降级路径：当 {@link NotificationSendService} 还未注入（启动早期 / 测试环境）时，
 * 退回 Wave 1 行为（仅打日志）。生产链路由 Spring 按构造保证依赖。
 */
@Service
public class NotificationDispatcher {

    private static final Logger log = LoggerFactory.getLogger(NotificationDispatcher.class);

    private final ObjectProvider<NotificationSendService> sendServiceProvider;

    public NotificationDispatcher(ObjectProvider<NotificationSendService> sendServiceProvider) {
        this.sendServiceProvider = sendServiceProvider;
    }

    @Async
    public void notifyUser(Long userId, String eventCode, String subject, String bodyText, String bodyHtml) {
        NotificationSendService svc = sendServiceProvider.getIfAvailable();
        if (svc == null) {
            log.warn("[notify-fallback] NotificationSendService unavailable; event={} user={} subject={}",
                eventCode, userId, subject);
            return;
        }
        try {
            svc.dispatch(userId, eventCode, subject, bodyText, bodyHtml);
        } catch (Exception e) {
            log.error("[notify-dispatch] event={} user={} failed", eventCode, userId, e);
        }
    }

    @Async
    public void notifyUsers(List<Long> userIds, String eventCode, String subject, String bodyText, String bodyHtml) {
        if (userIds == null) return;
        for (Long uid : userIds) {
            try {
                notifyUser(uid, eventCode, subject, bodyText, bodyHtml);
            } catch (Exception e) {
                log.error("notifyUser failed uid={} event={}", uid, eventCode, e);
            }
        }
    }
}
