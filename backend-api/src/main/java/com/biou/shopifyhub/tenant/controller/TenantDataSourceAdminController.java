package com.biou.shopifyhub.tenant.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.security.AesGcmUtil;
import com.biou.shopifyhub.tenant.entity.SysTenant;
import com.biou.shopifyhub.tenant.entity.SysTenantDatasource;
import com.biou.shopifyhub.tenant.mapper.SysTenantDatasourceMapper;
import com.biou.shopifyhub.tenant.mapper.SysTenantMapper;
import com.biou.shopifyhub.tenant.service.TenantDataSourceManager;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 多租户数据源管理（CRUD）— Sprint7 T26。
 * 与现有 {@link TenantDataSourceController} 并存：旧 controller 保留 4 个运行时端点，本 controller 提供完整 CRUD。
 */
@RestController
@RequestMapping("/admin/tenant/datasource-admin")
@PreAuthorize("hasRole('PLATFORM_SUPER')")
public class TenantDataSourceAdminController {

    private static final String PASSWORD_PLACEHOLDER = "****";

    private final SysTenantDatasourceMapper datasourceMapper;
    private final SysTenantMapper tenantMapper;
    private final TenantDataSourceManager manager;

    @Value("${ENCRYPT_KEY_AES_GCM:}")
    private String aesKey;

    public TenantDataSourceAdminController(SysTenantDatasourceMapper datasourceMapper,
                                           SysTenantMapper tenantMapper,
                                           TenantDataSourceManager manager) {
        this.datasourceMapper = datasourceMapper;
        this.tenantMapper = tenantMapper;
        this.manager = manager;
    }

    public record CreateReq(Long tenantId, String tenantCode, String jdbcUrl,
                            String username, String password, Integer poolMin, Integer poolMax) {}

    public record UpdateReq(Integer poolMin, Integer poolMax, String status) {}

    @GetMapping
    public Result<List<Map<String, Object>>> list() {
        List<SysTenantDatasource> rows = datasourceMapper.selectList(
            new QueryWrapper<SysTenantDatasource>().orderByAsc("id"));

        // 关联 sys_tenant 拿 tenantCode
        Set<Long> tenantIds = new HashSet<>();
        for (SysTenantDatasource r : rows) if (r.getTenantId() != null) tenantIds.add(r.getTenantId());
        Map<Long, String> idToCode = new HashMap<>();
        if (!tenantIds.isEmpty()) {
            List<SysTenant> tenants = tenantMapper.selectList(
                new QueryWrapper<SysTenant>().in("id", tenantIds));
            for (SysTenant t : tenants) idToCode.put(t.getId(), t.getCode());
        }

        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (SysTenantDatasource row : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", row.getId());
            m.put("tenantId", row.getTenantId());
            m.put("tenantCode", idToCode.get(row.getTenantId()));
            m.put("jdbcUrl", row.getJdbcUrl());
            m.put("username", row.getUsername());
            m.put("password", PASSWORD_PLACEHOLDER);
            m.put("poolMin", row.getPoolMin());
            m.put("poolMax", row.getPoolMax());
            m.put("status", row.getStatus());
            m.put("createdAt", row.getCreatedAt());
            out.add(m);
        }
        return Result.ok(out);
    }

    @PostMapping
    @RequireSensitiveOp("DATASOURCE_REGISTER")
    public Result<Long> create(@RequestBody CreateReq req) {
        if (req == null || req.tenantId() == null || req.jdbcUrl() == null || req.jdbcUrl().isBlank()
            || req.username() == null || req.username().isBlank()
            || req.password() == null || req.password().isBlank()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "tenantId/jdbcUrl/username/password 必填");
        }
        if (aesKey == null || aesKey.isBlank()) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "ENCRYPT_KEY_AES_GCM 未配置，无法加密数据源密码");
        }
        // 唯一性：同 tenantId 不允许重复 ACTIVE 行
        Long existing = datasourceMapper.selectCount(
            new QueryWrapper<SysTenantDatasource>().eq("tenant_id", req.tenantId()).eq("status", "ACTIVE"));
        if (existing != null && existing > 0) {
            throw new BusinessException(ResultCode.CONFLICT, "tenantId=" + req.tenantId() + " 已存在 ACTIVE 数据源");
        }

        SysTenantDatasource row = new SysTenantDatasource();
        row.setTenantId(req.tenantId());
        row.setJdbcUrl(req.jdbcUrl());
        row.setUsername(req.username());
        row.setEncryptedPassword(AesGcmUtil.encrypt(req.password(), aesKey));
        row.setPoolMin(req.poolMin() != null ? req.poolMin() : 5);
        row.setPoolMax(req.poolMax() != null ? req.poolMax() : 20);
        row.setStatus("ACTIVE");
        row.setCreatedAt(LocalDateTime.now());
        datasourceMapper.insert(row);

        // 触发单租户重载（若 sys_tenant 存在 ACTIVE 行，会注入到 DynamicRoutingDataSource）
        try {
            manager.register(req.tenantId());
        } catch (Exception ignored) {
            // 忽略：sys_tenant 行可能尚未建立；调用方可后续手动 reload
        }
        return Result.ok(row.getId());
    }

    @DeleteMapping("/{id}")
    @RequireSensitiveOp("DATASOURCE_REGISTER")
    public Result<Void> remove(@PathVariable Long id) {
        SysTenantDatasource row = datasourceMapper.selectById(id);
        if (row == null) throw new BusinessException(ResultCode.NOT_FOUND, "数据源 id=" + id + " 不存在");

        SysTenantDatasource upd = new SysTenantDatasource();
        upd.setId(id);
        upd.setStatus("DISABLED");
        datasourceMapper.updateById(upd);

        // 注销动态路由：通过 tenantId 反查 datasource_key 后 remove
        if (row.getTenantId() != null) {
            SysTenant t = tenantMapper.selectById(row.getTenantId());
            if (t != null && t.getDatasourceKey() != null && !"platform".equals(t.getDatasourceKey())) {
                try { manager.remove(t.getDatasourceKey()); } catch (Exception ignored) {}
            }
        }
        return Result.ok();
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody UpdateReq req) {
        SysTenantDatasource row = datasourceMapper.selectById(id);
        if (row == null) throw new BusinessException(ResultCode.NOT_FOUND, "数据源 id=" + id + " 不存在");

        SysTenantDatasource upd = new SysTenantDatasource();
        upd.setId(id);
        boolean dirty = false;
        if (req.poolMin() != null) { upd.setPoolMin(req.poolMin()); dirty = true; }
        if (req.poolMax() != null) { upd.setPoolMax(req.poolMax()); dirty = true; }
        if (req.status() != null && !req.status().isBlank()) { upd.setStatus(req.status()); dirty = true; }
        if (!dirty) return Result.ok();
        datasourceMapper.updateById(upd);

        // 重载该租户的连接池以便新参数 / 状态生效
        if (row.getTenantId() != null) {
            try { manager.register(row.getTenantId()); } catch (Exception ignored) {}
        }
        return Result.ok();
    }
}
