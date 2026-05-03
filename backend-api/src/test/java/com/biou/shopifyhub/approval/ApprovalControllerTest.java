package com.biou.shopifyhub.approval;

import com.biou.shopifyhub.approval.entity.ApprovalFlow;
import com.biou.shopifyhub.core.tenant.TenantContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T28: ApprovalController MVC 测试。Security 过滤器关闭，CurrentUser 由 TenantContext 注入。
 */
@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@ActiveProfiles("test")
@Transactional
class ApprovalControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ApprovalEngine engine;

    @BeforeEach
    void setUpUser() {
        TenantContext.set(1L, "platform", 1L, "tester");
    }

    @AfterEach
    void clearUser() {
        TenantContext.clear();
    }

    @Test
    void post_approval_returns_id() throws Exception {
        String body = json.writeValueAsString(Map.of(
            "type", "PRODUCT_ACCESS",
            "applicantId", 1,
            "tenantId", 1,
            "payload", Map.of("productId", 1, "reason", "test"),
            "approverId", 1
        ));
        mvc.perform(post("/approval").contentType("application/json").content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.id").exists())
            .andExpect(jsonPath("$.data.status").value("PENDING"));
    }

    @Test
    void post_approval_validation_fail_returns_error() throws Exception {
        String body = json.writeValueAsString(Map.of(
            "type", "PRODUCT_ACCESS",
            "applicantId", 1,
            "tenantId", 1,
            "payload", Map.of("productId", 1)
            // 没 approverId / approverRole → 422
        ));
        mvc.perform(post("/approval").contentType("application/json").content(body))
            .andExpect(jsonPath("$.code").value(org.hamcrest.Matchers.not(0)));
    }

    @Test
    void batch_approve_returns_counts() throws Exception {
        // 先建 2 个 flow
        ApprovalFlow f1 = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1), 1L, null));
        ApprovalFlow f2 = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 2), 1L, null));

        String body = json.writeValueAsString(Map.of(
            "flowIds", List.of(f1.getId(), f2.getId()),
            "comment", "batch test"
        ));
        mvc.perform(post("/approval/batch/approve").contentType("application/json").content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.ok").value(2))
            .andExpect(jsonPath("$.data.fail").value(0));
    }

    @Test
    void batch_approve_partial_failure() throws Exception {
        ApprovalFlow ok = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1), 1L, null));
        // 不存在的 id 99999999 → 失败
        String body = json.writeValueAsString(Map.of(
            "flowIds", List.of(ok.getId(), 99999999L),
            "comment", "partial"
        ));
        mvc.perform(post("/approval/batch/approve").contentType("application/json").content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.ok").value(1))
            .andExpect(jsonPath("$.data.fail").value(1));
    }
}
