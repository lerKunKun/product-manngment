package com.biou.shopifyhub.audit;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.audit.entity.SysAuditLog;
import com.biou.shopifyhub.audit.mapper.SysAuditLogMapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;

/**
 * Admin 审计日志查询。`sensitive` 列为 MySQL 保留字，需用 QueryWrapper 显式带反引号。
 */
@RestController
@RequestMapping("/admin/audit-log")
public class SysAuditLogController {

    private final SysAuditLogMapper auditMapper;

    public SysAuditLogController(SysAuditLogMapper auditMapper) {
        this.auditMapper = auditMapper;
    }

    @GetMapping
    public Result<Page<SysAuditLog>> list(@RequestParam(required = false) Long userId,
                                          @RequestParam(required = false) String module,
                                          @RequestParam(required = false) String action,
                                          @RequestParam(required = false) Boolean sensitive,
                                          @RequestParam(required = false) LocalDateTime from,
                                          @RequestParam(required = false) LocalDateTime to,
                                          @RequestParam(defaultValue = "1") int page,
                                          @RequestParam(defaultValue = "50") int size) {
        int safeSize = Math.min(Math.max(1, size), 200);
        int safePage = Math.max(1, page);
        QueryWrapper<SysAuditLog> q = new QueryWrapper<>();
        if (userId != null) q.eq("user_id", userId);
        if (module != null && !module.isBlank()) q.eq("module", module);
        if (action != null && !action.isBlank()) q.eq("action", action);
        if (sensitive != null) q.eq("`sensitive`", sensitive);
        if (from != null) q.ge("created_at", from);
        if (to != null) q.le("created_at", to);
        q.orderByDesc("id");
        Page<SysAuditLog> p = auditMapper.selectPage(new Page<>(safePage, safeSize), q);
        return Result.ok(p);
    }

    @GetMapping("/{id}")
    public Result<SysAuditLog> get(@PathVariable Long id) {
        SysAuditLog row = auditMapper.selectById(id);
        if (row == null) return Result.error(ResultCode.NOT_FOUND);
        return Result.ok(row);
    }
}
