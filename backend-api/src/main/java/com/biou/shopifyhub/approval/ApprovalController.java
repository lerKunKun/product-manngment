package com.biou.shopifyhub.approval;

import com.biou.shopifyhub.approval.entity.ApprovalFlow;
import com.biou.shopifyhub.approval.entity.ApprovalLog;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * W4-APP-02 审批中心 API。
 */
@RestController
@RequestMapping("/approval")
public class ApprovalController {

    private final ApprovalEngine engine;

    public ApprovalController(ApprovalEngine engine) {
        this.engine = engine;
    }

    @GetMapping
    public Result<List<ApprovalFlow>> list(@RequestParam(required = false) String type,
                                           @RequestParam(required = false) String status,
                                           @RequestParam(required = false) Long applicantId,
                                           @RequestParam(required = false) Long approverId) {
        return Result.ok(engine.list(type, status, applicantId, approverId));
    }

    @GetMapping("/{id}")
    public Result<ApprovalDetail> get(@PathVariable Long id) {
        ApprovalFlow f = engine.get(id);
        return Result.ok(new ApprovalDetail(f, engine.listLogs(id)));
    }

    @PostMapping
    public Result<ApprovalFlow> submit(@RequestBody SubmitBody body) {
        Long me = CurrentUser.userIdOrNull();
        Long applicant = body.applicantId() != null ? body.applicantId() : me;
        ApprovalEngine.SubmitRequest req = new ApprovalEngine.SubmitRequest(
            body.type(),
            applicant,
            body.targetUserId(),
            body.tenantId() != null ? body.tenantId() : CurrentUser.tenantId(),
            body.payload(),
            body.approverId(),
            body.approverRole()
        );
        return Result.ok(engine.submit(req));
    }

    @PostMapping("/{id}/approve")
    public Result<ApprovalFlow> approve(@PathVariable Long id, @RequestBody(required = false) DecisionBody body) {
        return Result.ok(engine.approve(id, CurrentUser.userIdOrThrow(), body == null ? null : body.comment()));
    }

    @PostMapping("/{id}/reject")
    public Result<ApprovalFlow> reject(@PathVariable Long id, @RequestBody(required = false) DecisionBody body) {
        return Result.ok(engine.reject(id, CurrentUser.userIdOrThrow(), body == null ? null : body.comment()));
    }

    @PostMapping("/{id}/resubmit")
    public Result<ApprovalFlow> resubmit(@PathVariable Long id, @RequestBody(required = false) ResubmitBody body) {
        return Result.ok(engine.resubmit(id, CurrentUser.userIdOrThrow(), body == null ? null : body.payload()));
    }

    @PostMapping("/{id}/cancel")
    public Result<ApprovalFlow> cancel(@PathVariable Long id) {
        return Result.ok(engine.cancel(id, CurrentUser.userIdOrThrow()));
    }

    @GetMapping("/pending/me")
    public Result<List<ApprovalFlow>> myPending() {
        return Result.ok(engine.pendingFor(CurrentUser.userIdOrThrow()));
    }

    public record SubmitBody(
        String type,
        Long applicantId,
        Long targetUserId,
        Long tenantId,
        Map<String, Object> payload,
        Long approverId,
        String approverRole
    ) {}

    public record DecisionBody(String comment) {}
    public record ResubmitBody(Map<String, Object> payload) {}

    public record ApprovalDetail(ApprovalFlow flow, List<ApprovalLog> logs) {}
}
