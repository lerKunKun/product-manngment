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
 * PRODUCT_ACCESS：审批通过后写 sys_data_scope（scope_type=PRODUCT, source=APPROVAL）。
 * payload 期望字段：productId(Long, 必填) / scopeType(String, 默认 PRODUCT) / access(String, 默认 READ) /
 *                  expiresAt(ISO LocalDateTime, 缺省 now+7d)。
 */
@Service
public class ProductAccessApprovalService implements ApprovalTypeHook {

    public static final String TYPE = "PRODUCT_ACCESS";

    private final SysDataScopeMapper scopeMapper;

    public ProductAccessApprovalService(SysDataScopeMapper scopeMapper) {
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
        Long productId = asLong(p.get("productId"));
        if (productId == null) {
            // 兼容写法：scopeId 也可
            productId = asLong(p.get("scopeId"));
        }
        if (productId == null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "productId / scopeId 必填");
        }
        Long userId = flow.getTargetUserId() != null ? flow.getTargetUserId() : flow.getApplicantId();
        String access = p.get("access") instanceof String s ? s : "READ";
        String scopeType = p.get("scopeType") instanceof String st ? st : "PRODUCT";

        SysDataScope ds = new SysDataScope();
        ds.setUserId(userId);
        ds.setScopeType(scopeType);
        ds.setScopeId(productId);
        ds.setAccess(access);
        ds.setSource("APPROVAL");
        ds.setApprovalId(flow.getId());
        ds.setCrossCompany(Boolean.FALSE);
        ds.setGrantedBy(grantedBy(flow));
        ds.setGrantedAt(LocalDateTime.now());
        LocalDateTime expiresAt = null;
        if (p.get("expiresAt") instanceof String es && !es.isBlank()) {
            try {
                expiresAt = LocalDateTime.parse(es);
            } catch (Exception ignore) { /* payload 内的 expiresAt 非 ISO 时走默认 7 天 */ }
        }
        ds.setExpiresAt(expiresAt == null ? LocalDateTime.now().plusDays(7) : expiresAt);
        ds.setStatus("ACTIVE");
        scopeMapper.insert(ds);
    }

    private static Long grantedBy(ApprovalFlow flow) {
        if (flow.getDecidedBy() != null) return flow.getDecidedBy();
        if (flow.getCurrentApproverId() != null) return flow.getCurrentApproverId();
        return flow.getApplicantId();
    }

    private static Long asLong(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        try { return Long.parseLong(v.toString()); } catch (Exception e) { return null; }
    }
}
