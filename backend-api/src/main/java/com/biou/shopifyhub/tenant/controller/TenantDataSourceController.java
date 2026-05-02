package com.biou.shopifyhub.tenant.controller;

import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.tenant.service.TenantDataSourceManager;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 多租户数据源运行时管理（W1-CORE-01）。
 * 仅 PLATFORM_SUPER 可访问（鉴权由 RBAC 拦截器处理；本期路径已在受保护范围）。
 */
@RestController
@RequestMapping("/admin/tenant/datasource")
public class TenantDataSourceController {

    private final TenantDataSourceManager manager;

    public TenantDataSourceController(TenantDataSourceManager manager) {
        this.manager = manager;
    }

    @GetMapping
    public Result<List<String>> list() {
        return Result.ok(manager.registeredKeys());
    }

    /** 全量重载：扫 sys_tenant_datasource 把缺失的 ACTIVE 数据源补上。 */
    @PostMapping("/reload")
    public Result<Map<String, Integer>> reload() {
        return Result.ok(manager.reload());
    }

    /** 单租户重载（替换已有连接池）。 */
    @PostMapping("/{tenantId}/register")
    @RequireSensitiveOp("TENANT_DS_REGISTER")
    public Result<Boolean> register(@PathVariable Long tenantId) {
        return Result.ok(manager.register(tenantId));
    }

    /** 注销 key 对应的数据源（platform 不允许）。 */
    @DeleteMapping("/{key}")
    @RequireSensitiveOp("TENANT_DS_REMOVE")
    public Result<Boolean> remove(@PathVariable String key) {
        return Result.ok(manager.remove(key));
    }
}
