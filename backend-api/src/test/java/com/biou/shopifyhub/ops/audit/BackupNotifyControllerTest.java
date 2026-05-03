package com.biou.shopifyhub.ops.audit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@ActiveProfiles("test")
class BackupNotifyControllerTest {

    @Autowired MockMvc mvc;

    @Test
    void notify_fail_loopback_passes() throws Exception {
        String body = """
            {"date":"2026-05-03","reason":"test"}
            """;
        mvc.perform(post("/ops/backup/notify-fail")
                .contentType("application/json")
                .content(body)
                .header("X-Forwarded-For", "127.0.0.1"))
            .andExpect(status().isOk());
    }

    @Test
    void notify_fail_external_ip_returns_403() throws Exception {
        String body = """
            {"date":"2026-05-03","reason":"test"}
            """;
        mvc.perform(post("/ops/backup/notify-fail")
                .contentType("application/json")
                .content(body)
                .header("X-Forwarded-For", "203.0.113.1"))
            .andExpect(status().is4xxClientError());
    }

    @Test
    void notify_success_loopback() throws Exception {
        String body = """
            {"date":"2026-05-03","bytes":1024,"sha256":"abc"}
            """;
        mvc.perform(post("/ops/backup/notify-success")
                .contentType("application/json")
                .content(body)
                .header("X-Forwarded-For", "127.0.0.1"))
            .andExpect(status().isOk());
    }
}
