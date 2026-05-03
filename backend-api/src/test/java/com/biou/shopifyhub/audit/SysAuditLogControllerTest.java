package com.biou.shopifyhub.audit;

import com.biou.shopifyhub.audit.entity.SysAuditLog;
import com.biou.shopifyhub.audit.mapper.SysAuditLogMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.Rollback;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@ActiveProfiles("test")
@Transactional
@Rollback
class SysAuditLogControllerTest {

    @Autowired MockMvc mvc;
    @Autowired SysAuditLogMapper auditMapper;

    @Test
    void list_returns_page() throws Exception {
        SysAuditLog row = newRow("noop", "POST", "/test");
        auditMapper.insert(row);

        mvc.perform(get("/admin/audit-log"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.records").isArray());
    }

    @Test
    void get_by_id_returns_log() throws Exception {
        SysAuditLog row = newRow("get_by_id", "GET", "/test/1");
        auditMapper.insert(row);

        mvc.perform(get("/admin/audit-log/" + row.getId()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.id").value(row.getId()));
    }

    @Test
    void export_returns_csv_with_bom() throws Exception {
        SysAuditLog row = newRow("export", "GET", "/test");
        auditMapper.insert(row);

        mvc.perform(get("/admin/audit-log/export"))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type", containsString("text/csv")))
            .andExpect(header().string("Content-Disposition", containsString("attachment")))
            .andExpect(content().string(startsWith("﻿")));
    }

    private SysAuditLog newRow(String action, String method, String uri) {
        SysAuditLog row = new SysAuditLog();
        row.setUserId(1L);
        row.setUsername("admin");
        row.setModule("test");
        row.setAction(action);
        row.setRequestMethod(method);
        row.setRequestUri(uri);
        row.setResponseStatus(200);
        row.setSensitive(false);
        row.setCreatedAt(LocalDateTime.now());
        return row;
    }
}
