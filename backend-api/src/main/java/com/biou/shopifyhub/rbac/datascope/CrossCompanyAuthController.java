package com.biou.shopifyhub.rbac.datascope;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysDataScope;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysDataScopeMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.List;

/**
 * W3-DS-01 跨公司授权 CRUD 端点。
 *
 * <p>跨公司授权（A 公司给 B 公司用户临时读取 A 的产品 7 天）必须带 {@code expires_at}，
 * 且过期时间在 [now+5min, now+180d] 之间。撤销 / 授予均走 {@link RequireSensitiveOp} 二次确认。
 *
 * <p>真实"24h 提醒 + 0:05 硬过期"调度由 W3-DS-03 在 {@link CrossAuthExpiryScheduler} 内落地。
 */
@RestController
@RequestMapping("/cross-auth")
public class CrossCompanyAuthController {

    private final SysDataScopeMapper scopeMapper;

    public CrossCompanyAuthController(SysDataScopeMapper scopeMapper) {
        this.scopeMapper = scopeMapper;
    }

    /** 列出跨公司授权（cross_company=1），可按 user_id / granter_company_id / status 过滤。 */
    @GetMapping
    public Result<List<SysDataScope>> list(@RequestParam(required = false) Long userId,
                                           @RequestParam(required = false) Long granterCompanyId,
                                           @RequestParam(required = false) String status) {
        LambdaQueryWrapper<SysDataScope> q = new LambdaQueryWrapper<SysDataScope>()
            .eq(SysDataScope::getCrossCompany, true);
        if (userId != null) q.eq(SysDataScope::getUserId, userId);
        if (granterCompanyId != null) q.eq(SysDataScope::getGranterCompanyId, granterCompanyId);
        if (status != null) q.eq(SysDataScope::getStatus, status);
        q.orderByDesc(SysDataScope::getCreatedAt);
        return Result.ok(scopeMapper.selectList(q));
    }

    /** 授予跨公司权限：必须带 expires_at，区间 [now+5min, now+180d]。敏感操作。 */
    @PostMapping
    @RequireSensitiveOp("CROSS_AUTH_GRANT")
    public Result<Long> grant(@RequestBody GrantRequest req) {
        if (req.expiresAt() == null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "跨公司授权必须设置过期时间");
        }
        LocalDateTime now = LocalDateTime.now();
        if (req.expiresAt().isBefore(now.plusMinutes(5))) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "过期时间至少 5 分钟以后");
        }
        if (req.expiresAt().isAfter(now.plusDays(180))) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "跨公司授权最长 180 天");
        }
        if (req.userId() == null || req.scopeType() == null || req.scopeId() == null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "userId / scopeType / scopeId 必填");
        }

        SysDataScope ds = new SysDataScope();
        ds.setUserId(req.userId());
        ds.setScopeType(req.scopeType());
        ds.setScopeId(req.scopeId());
        ds.setAccess(req.access() == null ? "READ" : req.access());
        ds.setSource("APPROVAL");
        ds.setCrossCompany(Boolean.TRUE);
        ds.setGrantedAt(now);
        ds.setExpiresAt(req.expiresAt());
        ds.setGrantedBy(req.grantedBy());            // TODO: 改为 TenantContext.userId() / CurrentUser
        ds.setGranterCompanyId(req.granterCompanyId());
        ds.setStatus("ACTIVE");
        scopeMapper.insert(ds);
        // TODO W3-DS-03: schedule 24h-before-expiry CROSS_AUTH_EXPIRING 通知
        return Result.ok(ds.getId());
    }

    /** 立即撤销一条授权。敏感操作。 */
    @PostMapping("/{id}/revoke")
    @RequireSensitiveOp("CROSS_AUTH_REVOKE")
    public Result<Void> revoke(@PathVariable Long id) {
        SysDataScope ds = scopeMapper.selectById(id);
        if (ds == null) return Result.error(ResultCode.NOT_FOUND);
        SysDataScope upd = new SysDataScope();
        upd.setId(id);
        upd.setStatus("REVOKED");
        upd.setRevokedAt(LocalDateTime.now());
        scopeMapper.updateById(upd);
        return Result.ok();
    }

    /** 授予请求体。grantedBy 暂由调用方传入；W1-RBAC 完整化后改取 CurrentUser。 */
    public record GrantRequest(
        Long userId,
        String scopeType,
        Long scopeId,
        String access,
        LocalDateTime expiresAt,
        Long grantedBy,
        Long granterCompanyId
    ) {}
}
