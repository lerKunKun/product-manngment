package com.biou.shopifyhub.approval;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.approval.entity.ApprovalFlow;
import com.biou.shopifyhub.approval.entity.ApprovalLog;
import com.biou.shopifyhub.approval.mapper.ApprovalFlowMapper;
import com.biou.shopifyhub.approval.mapper.ApprovalLogMapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUserRole;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysRoleMapper;
import com.biou.shopifyhub.core.mapper.SysUserRoleMapper;
import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 审批引擎。所有状态迁移均在事务中完成；通知派发在事务提交后异步触发。
 */
@Service
public class ApprovalEngine {

    private static final Logger log = LoggerFactory.getLogger(ApprovalEngine.class);

    private final ApprovalFlowMapper flowMapper;
    private final ApprovalLogMapper logMapper;
    private final SysUserRoleMapper userRoleMapper;
    private final SysRoleMapper roleMapper;
    private final NotificationDispatcher notifier;
    private final List<ApprovalTypeHook> hooks;

    public ApprovalEngine(
        ApprovalFlowMapper flowMapper,
        ApprovalLogMapper logMapper,
        SysUserRoleMapper userRoleMapper,
        SysRoleMapper roleMapper,
        NotificationDispatcher notifier,
        ObjectProvider<List<ApprovalTypeHook>> hooks
    ) {
        this.flowMapper = flowMapper;
        this.logMapper = logMapper;
        this.userRoleMapper = userRoleMapper;
        this.roleMapper = roleMapper;
        this.notifier = notifier;
        this.hooks = hooks.getIfAvailable(List::of);
    }

    @Transactional
    public ApprovalFlow submit(SubmitRequest req) {
        if (req.type() == null || req.type().isBlank())
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "type 必填");
        if (req.applicantId() == null)
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "applicantId 必填");
        if (req.payload() == null)
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "payload 必填");
        if (req.approverId() == null && (req.approverRole() == null || req.approverRole().isBlank()))
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "approverId 或 approverRole 至少一个");

        ApprovalFlow f = new ApprovalFlow();
        f.setTenantId(req.tenantId());
        f.setType(req.type());
        f.setApplicantId(req.applicantId());
        f.setTargetUserId(req.targetUserId() != null ? req.targetUserId() : req.applicantId());
        f.setPayload(req.payload());
        f.setStatus("PENDING");
        f.setCurrentApproverId(req.approverId());
        f.setCurrentApproverRole(req.approverRole());
        flowMapper.insert(f);

        writeLog(f.getId(), req.applicantId(), "SUBMIT", null, null);
        notifyApprovers(f, "审批待办", "您有新的审批待处理 (#" + f.getId() + " " + f.getType() + ")");
        return f;
    }

    @Transactional
    public ApprovalFlow approve(Long flowId, Long actorId, String comment) {
        ApprovalFlow f = mustGet(flowId);
        if (!"PENDING".equals(f.getStatus()))
            throw new BusinessException(ResultCode.CONFLICT, "当前状态不可通过：" + f.getStatus());
        assertActorCanDecide(f, actorId);

        f.setStatus("APPROVED");
        f.setDecidedBy(actorId);
        f.setDecidedAt(LocalDateTime.now());
        f.setDecisionComment(comment);
        flowMapper.updateById(f);
        writeLog(flowId, actorId, "APPROVE", comment, null);

        // 触发对应 type 的 hook（PRODUCT_ACCESS / CROSS_COMPANY_AUTH 等）
        for (ApprovalTypeHook h : hooks) {
            if (h.supports(f.getType())) {
                try {
                    h.onApproved(f);
                } catch (BusinessException be) {
                    throw be;
                } catch (Exception e) {
                    log.error("approval hook failed flowId={} type={}", flowId, f.getType(), e);
                    throw new BusinessException(ResultCode.INTERNAL_ERROR, "审批后处理失败：" + e.getMessage());
                }
                break;
            }
        }

        notifyApplicant(f, "审批已通过", "您的申请 #" + flowId + " 已通过");
        return f;
    }

    @Transactional
    public ApprovalFlow reject(Long flowId, Long actorId, String comment) {
        ApprovalFlow f = mustGet(flowId);
        if (!"PENDING".equals(f.getStatus()))
            throw new BusinessException(ResultCode.CONFLICT, "当前状态不可驳回：" + f.getStatus());
        assertActorCanDecide(f, actorId);

        f.setStatus("REJECTED");
        f.setDecidedBy(actorId);
        f.setDecidedAt(LocalDateTime.now());
        f.setDecisionComment(comment);
        flowMapper.updateById(f);
        writeLog(flowId, actorId, "REJECT", comment, null);

        notifyApplicant(f, "审批被驳回", "您的申请 #" + flowId + " 被驳回，可修改后重新提交");
        return f;
    }

    @Transactional
    public ApprovalFlow resubmit(Long flowId, Long applicantId, Map<String, Object> newPayload) {
        ApprovalFlow f = mustGet(flowId);
        if (!"REJECTED".equals(f.getStatus()))
            throw new BusinessException(ResultCode.CONFLICT, "仅 REJECTED 可重新提交");
        if (!f.getApplicantId().equals(applicantId))
            throw new BusinessException(ResultCode.FORBIDDEN, "只有申请人可重提");
        if (newPayload != null) f.setPayload(newPayload);

        f.setStatus("PENDING");
        f.setDecidedBy(null);
        f.setDecidedAt(null);
        f.setDecisionComment(null);
        flowMapper.updateById(f);
        // 重置 decided_* 需 SQL 兜底（MP updateById 默认忽略 null）
        flowMapper.update(null,
            new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<ApprovalFlow>()
                .eq(ApprovalFlow::getId, flowId)
                .set(ApprovalFlow::getDecidedBy, null)
                .set(ApprovalFlow::getDecidedAt, null)
                .set(ApprovalFlow::getDecisionComment, null));

        writeLog(flowId, applicantId, "RESUBMIT", null, f.getPayload());
        notifyApprovers(f, "审批待办（重提）", "申请 #" + flowId + " 已重新提交");
        return f;
    }

    @Transactional
    public ApprovalFlow cancel(Long flowId, Long applicantId) {
        ApprovalFlow f = mustGet(flowId);
        if (!"PENDING".equals(f.getStatus()))
            throw new BusinessException(ResultCode.CONFLICT, "仅 PENDING 可撤回");
        if (!f.getApplicantId().equals(applicantId))
            throw new BusinessException(ResultCode.FORBIDDEN, "只有申请人可撤回");

        f.setStatus("CANCELLED");
        flowMapper.updateById(f);
        writeLog(flowId, applicantId, "CANCEL", null, null);
        return f;
    }

    public ApprovalFlow get(Long flowId) {
        return mustGet(flowId);
    }

    public List<ApprovalLog> listLogs(Long flowId) {
        return logMapper.selectList(new LambdaQueryWrapper<ApprovalLog>()
            .eq(ApprovalLog::getFlowId, flowId)
            .orderByDesc(ApprovalLog::getCreatedAt));
    }

    public List<ApprovalFlow> list(String type, String status, Long applicantId, Long approverId) {
        LambdaQueryWrapper<ApprovalFlow> q = new LambdaQueryWrapper<>();
        if (type != null && !type.isBlank()) q.eq(ApprovalFlow::getType, type);
        if (status != null && !status.isBlank()) q.eq(ApprovalFlow::getStatus, status);
        if (applicantId != null) q.eq(ApprovalFlow::getApplicantId, applicantId);
        if (approverId != null) q.eq(ApprovalFlow::getCurrentApproverId, approverId);
        q.orderByDesc(ApprovalFlow::getCreatedAt);
        return flowMapper.selectList(q);
    }

    /** 当前用户的待办：current_approver_id == userId 或 current_approver_role 在该用户角色集合内。 */
    public List<ApprovalFlow> pendingFor(Long userId) {
        if (userId == null) return List.of();
        List<String> roleCodes = userRoleCodes(userId);
        LambdaQueryWrapper<ApprovalFlow> q = new LambdaQueryWrapper<ApprovalFlow>()
            .eq(ApprovalFlow::getStatus, "PENDING")
            .and(w -> {
                w.eq(ApprovalFlow::getCurrentApproverId, userId);
                if (!roleCodes.isEmpty()) w.or().in(ApprovalFlow::getCurrentApproverRole, roleCodes);
            })
            .orderByDesc(ApprovalFlow::getCreatedAt);
        return flowMapper.selectList(q);
    }

    // ===== 内部辅助 =====

    private ApprovalFlow mustGet(Long id) {
        ApprovalFlow f = flowMapper.selectById(id);
        if (f == null) throw new BusinessException(ResultCode.NOT_FOUND, "approval #" + id);
        return f;
    }

    private void assertActorCanDecide(ApprovalFlow f, Long actorId) {
        if (actorId == null) throw new BusinessException(ResultCode.UNAUTHORIZED);
        if (f.getCurrentApproverId() != null && f.getCurrentApproverId().equals(actorId)) return;
        if (f.getCurrentApproverRole() != null && !f.getCurrentApproverRole().isBlank()) {
            if (userHasRole(actorId, f.getCurrentApproverRole())) return;
        }
        throw new BusinessException(ResultCode.FORBIDDEN, "无权审批");
    }

    private boolean userHasRole(Long userId, String roleCode) {
        return userRoleCodes(userId).contains(roleCode);
    }

    private List<String> userRoleCodes(Long userId) {
        List<SysUserRole> urs = userRoleMapper.selectList(
            new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getUserId, userId));
        if (urs.isEmpty()) return List.of();
        List<Long> rids = urs.stream().map(SysUserRole::getRoleId).toList();
        return roleMapper.selectBatchIds(rids).stream().map(r -> r.getCode()).toList();
    }

    private void writeLog(Long flowId, Long actorId, String action, String comment, Map<String, Object> snapshot) {
        ApprovalLog l = new ApprovalLog();
        l.setFlowId(flowId);
        l.setActorId(actorId);
        l.setAction(action);
        l.setComment(comment);
        l.setPayloadSnapshot(snapshot);
        logMapper.insert(l);
    }

    private void notifyApprovers(ApprovalFlow f, String subject, String text) {
        Map<String, Object> ctx = bodyCtx(f);
        if (f.getCurrentApproverId() != null) {
            notifier.notifyUser(f.getCurrentApproverId(),
                NotificationEventCode.APPROVAL_PENDING, subject, text, renderHtml(subject, text, ctx));
        } else if (f.getCurrentApproverRole() != null) {
            // 任一角色签批模式：暂仅打日志（生产应展开为该角色全员发通知；W4-APP-04 调度独立追加）
            log.info("[approval-pending-role] flowId={} role={} subject={}",
                f.getId(), f.getCurrentApproverRole(), subject);
        }
    }

    private void notifyApplicant(ApprovalFlow f, String subject, String text) {
        notifier.notifyUser(f.getApplicantId(),
            NotificationEventCode.APPROVAL_DECIDED, subject, text, renderHtml(subject, text, bodyCtx(f)));
    }

    private static Map<String, Object> bodyCtx(ApprovalFlow f) {
        Map<String, Object> m = new HashMap<>();
        m.put("flowId", f.getId());
        m.put("type", f.getType());
        m.put("status", f.getStatus());
        return m;
    }

    private static String renderHtml(String subject, String text, Map<String, Object> ctx) {
        return "<h3>" + escape(subject) + "</h3><p>" + escape(text) + "</p><pre>" + escape(ctx.toString()) + "</pre>";
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /** 提交请求 DTO（避免 Controller / 测试都拼一堆参数）。 */
    public record SubmitRequest(
        String type,
        Long applicantId,
        Long targetUserId,
        Long tenantId,
        Map<String, Object> payload,
        Long approverId,
        String approverRole
    ) {}
}
