package com.biou.shopifyhub.rbac;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysRole;
import com.biou.shopifyhub.core.entity.SysUserRole;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysRoleMapper;
import com.biou.shopifyhub.core.mapper.SysUserRoleMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Admin 角色管理：列表 / 详情（含权限码 + 用户数）/ 新建自定义角色 / 重置权限关联 / 角色下用户。
 *
 * <p>权限关联表 sys_role_permission 走 JdbcTemplate 直查（schema 用 permission_id，需 JOIN sys_permission 取 code）。
 */
@RestController
@RequestMapping("/admin/role")
public class SysRoleController {

    private final SysRoleMapper roleMapper;
    private final SysUserRoleMapper userRoleMapper;
    private final JdbcTemplate jdbc;

    public SysRoleController(SysRoleMapper roleMapper, SysUserRoleMapper userRoleMapper, JdbcTemplate jdbc) {
        this.roleMapper = roleMapper;
        this.userRoleMapper = userRoleMapper;
        this.jdbc = jdbc;
    }

    @GetMapping
    public Result<List<SysRole>> list() {
        return Result.ok(roleMapper.selectList(new LambdaQueryWrapper<SysRole>().orderByAsc(SysRole::getId)));
    }

    @GetMapping("/{id}")
    public Result<RoleDetail> get(@PathVariable Long id) {
        SysRole role = roleMapper.selectById(id);
        if (role == null) return Result.error(ResultCode.NOT_FOUND);
        List<String> codes = jdbc.queryForList(
            "SELECT p.code FROM sys_role_permission rp JOIN sys_permission p ON rp.permission_id = p.id WHERE rp.role_id = ?",
            String.class, id);
        Long userCount = userRoleMapper.selectCount(new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getRoleId, id));
        return Result.ok(new RoleDetail(role, codes, userCount == null ? 0L : userCount));
    }

    @PostMapping
    public Result<Long> create(@RequestBody CreateBody body) {
        if (body == null || body.code() == null || body.code().isBlank() || body.name() == null || body.name().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "code/name 必填");
        }
        Long exists = roleMapper.selectCount(new LambdaQueryWrapper<SysRole>().eq(SysRole::getCode, body.code()));
        if (exists != null && exists > 0) {
            throw new BusinessException(ResultCode.CONFLICT, "角色 code 已存在");
        }
        SysRole r = new SysRole();
        r.setCode(body.code());
        r.setName(body.name());
        r.setScope(body.scope() == null ? "TENANT" : body.scope());
        r.setDescription(body.description());
        r.setBuiltin(false);
        LocalDateTime now = LocalDateTime.now();
        r.setCreatedAt(now);
        r.setUpdatedAt(now);
        roleMapper.insert(r);
        return Result.ok(r.getId());
    }

    @PutMapping("/{id}/permissions")
    @RequireSensitiveOp("ROLE_PERMISSION_CHANGE")
    @Transactional
    public Result<Void> resetPermissions(@PathVariable Long id, @RequestBody PermissionsBody body) {
        SysRole role = roleMapper.selectById(id);
        if (role == null) return Result.error(ResultCode.NOT_FOUND);
        if (Boolean.TRUE.equals(role.getBuiltin())) {
            return Result.error(ResultCode.FORBIDDEN, "内置角色不允许修改权限");
        }
        List<String> codes = body == null || body.permissionCodes() == null ? List.of() : body.permissionCodes();

        jdbc.update("DELETE FROM sys_role_permission WHERE role_id = ?", id);
        if (!codes.isEmpty()) {
            // code → id 解析；忽略不存在的 code（不抛异常，避免脏前端误传整批失败）
            List<Long> permIds = new ArrayList<>();
            for (String code : codes) {
                if (code == null || code.isBlank()) continue;
                List<Long> hit = jdbc.queryForList("SELECT id FROM sys_permission WHERE code = ?", Long.class, code);
                if (!hit.isEmpty()) permIds.add(hit.get(0));
            }
            for (Long pid : permIds) {
                jdbc.update("INSERT INTO sys_role_permission (role_id, permission_id) VALUES (?, ?)", id, pid);
            }
        }
        SysRole upd = new SysRole();
        upd.setId(id);
        upd.setUpdatedAt(LocalDateTime.now());
        roleMapper.updateById(upd);
        return Result.ok();
    }

    @GetMapping("/{id}/users")
    public Result<List<Long>> users(@PathVariable Long id) {
        List<SysUserRole> rows = userRoleMapper.selectList(new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getRoleId, id));
        return Result.ok(rows.stream().map(SysUserRole::getUserId).distinct().toList());
    }

    public record CreateBody(String code, String name, String scope, String description) {}
    public record PermissionsBody(List<String> permissionCodes) {}
    public record RoleDetail(SysRole role, List<String> permissionCodes, Long userCount) {}
}
