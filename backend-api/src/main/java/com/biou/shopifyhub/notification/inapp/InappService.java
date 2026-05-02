package com.biou.shopifyhub.notification.inapp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.core.tenant.TenantContext;
import com.biou.shopifyhub.notification.inapp.entity.InappMessage;
import com.biou.shopifyhub.notification.inapp.mapper.InappMessageMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * W4-MAIL-02：站内信通道。
 * 由 NotificationSendService.dispatch INAPP 分支调用 {@link #send}（详见 InappBridge）。
 */
@Service
public class InappService {

    private static final Logger log = LoggerFactory.getLogger(InappService.class);

    private final InappMessageMapper mapper;

    public InappService(InappMessageMapper mapper) {
        this.mapper = mapper;
    }

    public Long send(Long userId, String eventCode, String subject,
                     String bodyText, String bodyHtml, String linkUrl) {
        if (userId == null) {
            log.warn("[inapp-skip] event={} userId=null", eventCode);
            return null;
        }
        InappMessage m = new InappMessage();
        m.setTenantId(TenantContext.tenantId());
        m.setUserId(userId);
        m.setEventCode(eventCode);
        m.setSubject(subject == null ? "" : (subject.length() > 256 ? subject.substring(0, 256) : subject));
        m.setBodyText(bodyText);
        m.setBodyHtml(bodyHtml);
        m.setLinkUrl(linkUrl);
        mapper.insert(m);
        log.info("[inapp] sent id={} user={} event={}", m.getId(), userId, eventCode);
        return m.getId();
    }

    public IPage<InappMessage> list(Long userId, boolean onlyUnread, int page, int size) {
        Page<InappMessage> p = new Page<>(Math.max(1, page), Math.min(100, Math.max(1, size)));
        LambdaQueryWrapper<InappMessage> q = new LambdaQueryWrapper<InappMessage>()
            .eq(InappMessage::getUserId, userId)
            .orderByDesc(InappMessage::getCreatedAt);
        if (onlyUnread) q.isNull(InappMessage::getReadAt);
        return mapper.selectPage(p, q);
    }

    public boolean markRead(Long userId, Long messageId) {
        InappMessage row = mapper.selectById(messageId);
        if (row == null || !userId.equals(row.getUserId())) return false;
        if (row.getReadAt() != null) return true;
        row.setReadAt(LocalDateTime.now());
        mapper.updateById(row);
        return true;
    }

    public int markAllRead(Long userId) {
        LambdaUpdateWrapper<InappMessage> u = new LambdaUpdateWrapper<InappMessage>()
            .eq(InappMessage::getUserId, userId)
            .isNull(InappMessage::getReadAt)
            .set(InappMessage::getReadAt, LocalDateTime.now());
        return mapper.update(null, u);
    }

    public long unreadCount(Long userId) {
        return mapper.selectCount(new LambdaQueryWrapper<InappMessage>()
            .eq(InappMessage::getUserId, userId)
            .isNull(InappMessage::getReadAt));
    }
}
