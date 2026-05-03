package com.biou.shopifyhub.approval;

import com.biou.shopifyhub.approval.entity.ApprovalFlow;
import com.biou.shopifyhub.approval.entity.ApprovalLog;
import com.biou.shopifyhub.core.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.Rollback;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * T28: ApprovalEngine 集成测试。
 * 使用现有 platform 库（host mysql）+ @Transactional 自动 rollback。
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
@Rollback
class ApprovalEngineTest {

    @Autowired
    ApprovalEngine engine;

    @Test
    void submit_creates_flow_and_log() {
        ApprovalFlow f = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L,
            Map.of("productId", 1, "reason", "test"),
            1L, null
        ));
        assertNotNull(f.getId());
        assertEquals("PENDING", f.getStatus());
        assertEquals("PRODUCT_ACCESS", f.getType());

        List<ApprovalLog> logs = engine.listLogs(f.getId());
        assertEquals(1, logs.size());
        assertEquals("SUBMIT", logs.get(0).getAction());
    }

    @Test
    void submit_rejects_missing_type() {
        assertThrows(BusinessException.class, () -> engine.submit(new ApprovalEngine.SubmitRequest(
            null, 1L, 1L, 1L, Map.of("k", "v"), 1L, null
        )));
    }

    @Test
    void submit_rejects_missing_approver() {
        assertThrows(BusinessException.class, () -> engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1),
            null, null
        )));
    }

    @Test
    void approve_changes_status_and_writes_log() {
        ApprovalFlow f = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1), 1L, null
        ));
        engine.approve(f.getId(), 1L, "OK");

        ApprovalFlow after = engine.get(f.getId());
        assertEquals("APPROVED", after.getStatus());
        assertEquals(1L, after.getDecidedBy());
        assertNotNull(after.getDecidedAt());
        assertEquals("OK", after.getDecisionComment());

        assertEquals(2, engine.listLogs(f.getId()).size());
    }

    @Test
    void reject_then_resubmit_resets_to_pending() {
        ApprovalFlow f = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1), 1L, null
        ));
        engine.reject(f.getId(), 1L, "理由不充分");
        assertEquals("REJECTED", engine.get(f.getId()).getStatus());

        engine.resubmit(f.getId(), 1L, Map.of("productId", 1, "reason", "补充理由"));
        ApprovalFlow after = engine.get(f.getId());
        assertEquals("PENDING", after.getStatus());
        assertNull(after.getDecidedBy());
        assertNull(after.getDecidedAt());
    }

    @Test
    void resubmit_only_by_applicant() {
        ApprovalFlow f = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1), 1L, null
        ));
        engine.reject(f.getId(), 1L, "no");
        assertThrows(BusinessException.class,
            () -> engine.resubmit(f.getId(), 999L, Map.of("k", "v")));
    }

    @Test
    void cancel_only_by_applicant() {
        ApprovalFlow f = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1), 1L, null
        ));
        // 非 applicant 撤销
        assertThrows(BusinessException.class, () -> engine.cancel(f.getId(), 999L));
        // applicant 撤销
        engine.cancel(f.getId(), 1L);
        assertEquals("CANCELLED", engine.get(f.getId()).getStatus());
    }

    @Test
    void approve_by_wrong_user_throws() {
        ApprovalFlow f = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1),
            1L, null
        ));
        assertThrows(BusinessException.class, () -> engine.approve(f.getId(), 999L, "test"));
    }

    @Test
    void approve_terminal_state_conflicts() {
        ApprovalFlow f = engine.submit(new ApprovalEngine.SubmitRequest(
            "PRODUCT_ACCESS", 1L, 1L, 1L, Map.of("productId", 1), 1L, null
        ));
        engine.approve(f.getId(), 1L, "ok");
        // 重复 approve 应该 conflict
        assertThrows(BusinessException.class, () -> engine.approve(f.getId(), 1L, "again"));
    }
}
