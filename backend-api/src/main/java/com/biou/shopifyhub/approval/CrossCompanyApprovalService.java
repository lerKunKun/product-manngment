package com.biou.shopifyhub.approval;

import com.biou.shopifyhub.approval.entity.ApprovalFlow;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysDataScope;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysDataScopeMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * CROSS_COMPANY_AUTH：审批通过后写跨公司 sys_data_scope（cross_company=true）。
 * payload 期望字段：scopeType / scopeId（必填） / expiresAt（ISO，缺省 now+7d） /
 *                  granterCompanyId / access（默认 READ）。
 */
@Service
public class CrossCompanyApprovalService implements ApprovalTypeHook {

    public static final String TYPE = "CROSS_COMPANY_AUTH";

    private final SysDataScopeMapper scopeMapper;

    public CrossCompanyApprovalService(SysDataScopeMapper scopeMapper) {
        this.scopeMapper = scopeMapper;
    }

    @Override
    public boolean supports(String type) {
        return TYPE.equals(type);
    }

    @Override
    public void onApproved(ApprovalFlow flow) {
        Map<String, Object> p = flow.getPayload();
        if (p == null) throw new BusinessException(ResultCode.VALIDATION_FAILED, "payload 缺失");
        Long scopeId = asLong(p.get("scopeId"));
        String scopeType = p.get("scopeType") instanceof String s ? s : null;
        if (scopeId == null || scopeType == null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "scopeType / scopeId 必填");
        }
        Long userId = flow.getTargetUserId() != null ? flow.getTargetUserId() : flow.getApplicantId();
        String access = p.get("access") instanceof String a ? a : "READ";
        Long granterCompanyId = asLong(p.get("granterCompanyId"));

        LocalDateTime expiresAt = null;
        if (p.get("expiresAt") instanceof String es && !es.isBlank()) {
            try { expiresAt = LocalDateTime.parse(es); } catch (Exception ignore) { /* fall through */ }
        }
        if (expiresAt == null) expiresAt = LocalDateTime.now().plusDays(7);

        SysDataScope ds = new SysDataScope();
        ds.setUserId(userId);
        ds.setScopeType(scopeType);
        ds.setScopeId(scopeId);
        ds.setAccess(access);
        ds.setSource("APPROVAL");
        ds.setApprovalId(flow.getId());
        ds.setCrossCompany(Boolean.TRUE);
        ds.setGrantedAt(LocalDateTime.now());
        ds.setExpiresAt(expiresAt);
        ds.setGranterCompanyId(granterCompanyId);
        ds.setStatus("ACTIVE");
        scopeMapper.insert(ds);
    }

    private static Long asLong(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        try { return Long.parseLong(v.toString()); } catch (Exception e) { return null; }
    }
}
