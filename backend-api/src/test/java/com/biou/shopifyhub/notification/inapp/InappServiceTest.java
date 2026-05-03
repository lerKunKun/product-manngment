package com.biou.shopifyhub.notification.inapp;

import com.biou.shopifyhub.notification.inapp.entity.InappMessage;
import com.biou.shopifyhub.notification.inapp.mapper.InappMessageMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.Rollback;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * T28: InappService 集成测试。
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
@Rollback
class InappServiceTest {

    @Autowired InappService service;
    @Autowired InappMessageMapper mapper;

    @Test
    void send_creates_message() {
        Long id = service.send(1L, "TEST_EVENT", "测试", "正文", null, null);
        assertNotNull(id);
        InappMessage m = mapper.selectById(id);
        assertEquals(1L, m.getUserId());
        assertEquals("TEST_EVENT", m.getEventCode());
        assertEquals("测试", m.getSubject());
        assertNull(m.getReadAt());
    }

    @Test
    void send_with_null_user_returns_null() {
        Long id = service.send(null, "TEST", "x", "y", null, null);
        assertNull(id);
    }

    @Test
    void send_truncates_long_subject() {
        String big = "x".repeat(300);
        Long id = service.send(1L, "T", big, "b", null, null);
        InappMessage m = mapper.selectById(id);
        assertEquals(256, m.getSubject().length());
    }

    @Test
    void mark_read_by_owner_only() {
        Long id = service.send(1L, "TEST", "t", "b", null, null);
        // 非 owner markRead 不生效
        boolean wrongUser = service.markRead(2L, id);
        assertFalse(wrongUser);
        assertNull(mapper.selectById(id).getReadAt());
        // owner markRead 生效
        boolean ok = service.markRead(1L, id);
        assertTrue(ok);
        assertNotNull(mapper.selectById(id).getReadAt());
    }

    @Test
    void mark_read_idempotent() {
        Long id = service.send(1L, "T", "a", "b", null, null);
        service.markRead(1L, id);
        java.time.LocalDateTime first = mapper.selectById(id).getReadAt();
        // 再次 markRead 仍 true 但不更新时间
        assertTrue(service.markRead(1L, id));
        assertEquals(first, mapper.selectById(id).getReadAt());
    }

    @Test
    void unread_count_excludes_read() {
        long base = service.unreadCount(987654321L); // 干净 user
        service.send(987654321L, "T", "a", "b", null, null);
        Long id2 = service.send(987654321L, "T", "a", "b", null, null);
        service.send(987654321L, "T", "a", "b", null, null);
        service.markRead(987654321L, id2);
        assertEquals(base + 2, service.unreadCount(987654321L));
    }

    @Test
    void mark_all_read_clears_unread() {
        long uid = 876543210L;
        service.send(uid, "T", "a", "b", null, null);
        service.send(uid, "T", "a", "b", null, null);
        int updated = service.markAllRead(uid);
        assertTrue(updated >= 2);
        assertEquals(0, service.unreadCount(uid));
    }
}
