package com.biou.shopifyhub.notification.subscription;

import com.biou.shopifyhub.notification.subscription.entity.NotificationLog;
import com.biou.shopifyhub.notification.subscription.mapper.NotificationLogMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.Rollback;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@ActiveProfiles("test")
@Transactional
@Rollback
class NotificationLogControllerTest {

    @Autowired MockMvc mvc;
    @Autowired NotificationLogMapper logMapper;

    @Test
    void list_with_status_filter_returns_paginated() throws Exception {
        insertLog(1L, "TEST_EVENT", "DINGTALK", "SENT");
        insertLog(1L, "TEST_EVENT", "DINGTALK", "SENT");
        insertLog(1L, "TEST_EVENT", "EMAIL", "FAILED");

        mvc.perform(get("/admin/notification-log").param("status", "SENT"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.records").isArray())
            .andExpect(jsonPath("$.data.total").exists());
    }

    @Test
    void get_by_id_returns_log() throws Exception {
        Long id = insertLog(1L, "TEST", "EMAIL", "SENT");
        mvc.perform(get("/admin/notification-log/" + id))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.id").value(id))
            .andExpect(jsonPath("$.data.eventCode").value("TEST"));
    }

    @Test
    void stats_returns_status_counts() throws Exception {
        insertLog(1L, "X", "DINGTALK", "SENT");
        insertLog(1L, "X", "DINGTALK", "FAILED");
        mvc.perform(get("/admin/notification-log/stats"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0));
    }

    private Long insertLog(Long userId, String eventCode, String channel, String status) {
        NotificationLog l = new NotificationLog();
        l.setUserId(userId);
        l.setEventCode(eventCode);
        l.setChannel(channel);
        l.setStatus(status);
        l.setAttemptCount(0);
        logMapper.insert(l);
        return l.getId();
    }
}
