package com.biou.shopifyhub.notification.inapp;

import org.springframework.stereotype.Component;

/**
 * W4-MAIL-02 ↔ G2 协调桥接。
 *
 * G3 与 G2 并行开发：G2 的 {@code NotificationSendService.dispatch} INAPP 分支当前打 SKIPPED 占位。
 * G2 完成后应注入本 bridge 或直接注入 {@link InappService} 来落库。
 *
 * 暴露在独立的 {@code @Component} 是为了：
 *  1. G2 不依赖 inapp 包内部细节；
 *  2. 即使 G2 没改造完，本 bridge 也已 ready，手动调用即可。
 */
@Component
public class InappBridge {

    private final InappService inappService;

    public InappBridge(InappService inappService) {
        this.inappService = inappService;
    }

    /**
     * G2 NotificationSendService.dispatch 在 INAPP 分支中调用本方法即可。
     * 返回插入的 inapp_message.id，便于 send_log 关联（G2 持久化通道日志时用）。
     */
    public Long send(Long userId, String eventCode, String subject,
                     String bodyText, String bodyHtml, String linkUrl) {
        return inappService.send(userId, eventCode, subject, bodyText, bodyHtml, linkUrl);
    }
}
