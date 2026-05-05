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
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
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
import java.util.List;
import java.util.Map;

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
    private final UserRolePermissionService rbac;

    public SysRoleController(SysRoleMapper roleMapper, SysUserRoleMapper userRoleMapper, JdbcTemplate jdbc,
                             UserRolePermissionService rbac) {
        this.roleMapper = roleMapper;
        this.userRoleMapper = userRoleMapper;
        this.jdbc = jdbc;
        this.rbac = rbac;
    }

    @GetMapping
    public Result<List<RoleListItem>> list() {
        List<SysRole> roles = roleMapper.selectList(new LambdaQueryWrapper<SysRole>().orderByAsc(SysRole::getId));
        if (roles.isEmpty()) return Result.ok(List.of());
        // 一次 group by 解决 N+1：拿每个角色的权限数 + 用户数。
        Map<Long, Long> permCount = new HashMap<>();
        jdbc.query(
            "SELECT role_id, COUNT(*) AS c FROM sys_role_permission GROUP BY role_id",
            rs -> { permCount.put(rs.getLong("role_id"), rs.getLong("c")); }
        );
        Map<Long, Long> userCount = new HashMap<>();
        jdbc.query(
            "SELECT role_id, COUNT(DISTINCT user_id) AS c FROM sys_user_role GROUP BY role_id",
            rs -> { userCount.put(rs.getLong("role_id"), rs.getLong("c")); }
        );
        List<RoleListItem> out = new ArrayList<>(roles.size());
        for (SysRole r : roles) {
            out.add(new RoleListItem(
                r,
                permCount.getOrDefault(r.getId(), 0L),
                userCount.getOrDefault(r.getId(), 0L)
            ));
        }
        return Result.ok(out);
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
    @PreAuthorize("hasRole('PLATFORM_SUPER')")
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
    @PreAuthorize("hasRole('PLATFORM_SUPER')")
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
        // 该角色的权限变了 → 持有该角色的所有用户 cache 失效。粗放走 prefix invalidate
        // （成本小：cache:rbac:user:* 在 dev 量级几十个 key），生产换 SCAN 方案。
        rbac.invalidateAll();
        return Result.ok();
    }

    @GetMapping("/{id}/users")
    public Result<List<Long>> users(@PathVariable Long id) {
        List<SysUserRole> rows = userRoleMapper.selectList(new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getRoleId, id));
        return Result.ok(rows.stream().map(SysUserRole::getUserId).distinct().toList());
    }

    /**
     * 删除自定义角色。内置角色禁删；仍有用户引用时禁删（前端先取消用户绑定再来）。
     * 同步清理 sys_role_permission 记录。
     */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_SUPER')")
    @RequireSensitiveOp("ROLE_DELETE")
    @Transactional
    public Result<Void> delete(@PathVariable Long id) {
        SysRole role = roleMapper.selectById(id);
        if (role == null) return Result.error(ResultCode.NOT_FOUND);
        if (Boolean.TRUE.equals(role.getBuiltin())) {
            return Result.error(ResultCode.FORBIDDEN, "内置角色禁删");
        }
        Long refCount = userRoleMapper.selectCount(
            new LambdaQueryWrapper<SysUserRole>().eq(SysUserRole::getRoleId, id));
        if (refCount != null && refCount > 0) {
            return Result.error(ResultCode.CONFLICT,
                "仍有 " + refCount + " 个用户使用该角色，请先解除绑定");
        }
        jdbc.update("DELETE FROM sys_role_permission WHERE role_id = ?", id);
        roleMapper.deleteById(id);
        return Result.ok();
    }

    /** 编辑角色基本信息（name / description）—— code 与 scope 不允许改（影响数据范围语义）。 */
    @PutMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_SUPER')")
    public Result<Void> update(@PathVariable Long id, @RequestBody UpdateBody body) {
        SysRole role = roleMapper.selectById(id);
        if (role == null) return Result.error(ResultCode.NOT_FOUND);
        if (Boolean.TRUE.equals(role.getBuiltin())) {
            return Result.error(ResultCode.FORBIDDEN, "内置角色禁改");
        }
        if (body.name() != null && !body.name().isBlank()) role.setName(body.name());
        if (body.description() != null) role.setDescription(body.description());
        role.setUpdatedAt(LocalDateTime.now());
        roleMapper.updateById(role);
        return Result.ok();
    }

    public record CreateBody(String code, String name, String scope, String description) {}
    public record UpdateBody(String name, String description) {}
    public record PermissionsBody(List<String> permissionCodes) {}
    public record RoleDetail(SysRole role, List<String> permissionCodes, Long userCount) {}
    /** list 接口扩展：把 SysRole 字段平铺 + 加聚合字段，避免前端再发 N 次 detail。 */
    public record RoleListItem(SysRole role, Long permissionCount, Long userCount) {}
}
