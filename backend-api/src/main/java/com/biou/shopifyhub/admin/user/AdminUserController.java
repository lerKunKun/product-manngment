package com.biou.shopifyhub.admin.user;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.admin.user.dto.AdminUserListItem;
import com.biou.shopifyhub.admin.user.dto.CreateUserReq;
import com.biou.shopifyhub.admin.user.dto.ImpersonateResp;
import com.biou.shopifyhub.admin.user.dto.UpdateUserReq;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.entity.SysRole;
import com.biou.shopifyhub.org.entity.SysOrg;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Admin 员工管理：列表、CRUD、批量、重置密码、Impersonate。
 *
 * <p>路径 `/admin/users/**` 由 SecurityConfig 默认走 .authenticated()；
 * 高敏感动作（reset-password / impersonate）额外走 @RequireSensitiveOp 二次确认。
 */
@RestController
@RequestMapping("/admin/users")
public class AdminUserController {

    private final AdminUserService service;

    public AdminUserController(AdminUserService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('PERM_USER:READ')")
    public Result<Page<AdminUserListItem>> list(@RequestParam(required = false) String keyword,
                                                @RequestParam(required = false) String status,
                                                @RequestParam(required = false) String userType,
                                                @RequestParam(required = false) Long deptId,
                                                /** 子孙过滤：前端选中节点 → 传该节点 + 所有子孙 id；命中任一即算。
                                                 *  与 deptId 二选一传，同时传时 deptIds 优先。 */
                                                @RequestParam(required = false) List<Long> deptIds,
                                                @RequestParam(defaultValue = "1") int page,
                                                @RequestParam(defaultValue = "20") int size) {
        return Result.ok(service.list(keyword, status, userType, deptId, deptIds, page, size));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_USER:READ')")
    public Result<AdminUserListItem> get(@PathVariable Long id) {
        return Result.ok(service.getOne(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Map<String, Long>> create(@RequestBody CreateUserReq req) {
        Long id = service.create(req);
        return Result.ok(Map.of("id", id));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Void> update(@PathVariable Long id, @RequestBody UpdateUserReq req) {
        service.update(id, req);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Void> delete(@PathVariable Long id) {
        service.softDelete(id);
        return Result.ok();
    }

    @PostMapping("/{id}/freeze")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Void> freeze(@PathVariable Long id) {
        service.freeze(id, true);
        return Result.ok();
    }

    @PostMapping("/{id}/unfreeze")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Void> unfreeze(@PathVariable Long id) {
        service.freeze(id, false);
        return Result.ok();
    }

    /** 重置密码：高敏感，需 X-Sensitive-Token；返回临时明文（操作员一次性看到）。 */
    @PostMapping("/{id}/reset-password")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    @RequireSensitiveOp("USER_RESET_PASSWORD")
    public Result<Map<String, String>> resetPassword(@PathVariable Long id) {
        String pwd = service.resetPassword(id);
        return Result.ok(Map.of("temporaryPassword", pwd, "ttl", "ONE_TIME"));
    }

    @PostMapping("/{id}/assign-roles")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Void> assignRoles(@PathVariable Long id, @RequestBody AssignRolesBody body) {
        service.assignRoles(id, body == null ? null : body.roleIds);
        return Result.ok();
    }

    @PostMapping("/batch-update-dept")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Map<String, Integer>> batchUpdateDept(@RequestBody BatchDeptBody body) {
        int n = service.batchUpdateDept(body == null ? null : body.userIds, body == null ? null : body.deptId);
        return Result.ok(Map.of("affected", n));
    }

    @PostMapping("/batch-update-roles")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Map<String, Integer>> batchUpdateRoles(@RequestBody BatchRolesBody body) {
        int n = service.batchUpdateRoles(body == null ? null : body.userIds, body == null ? null : body.roleIds);
        return Result.ok(Map.of("affected", n));
    }

    @PostMapping("/batch-freeze")
    @PreAuthorize("hasAuthority('PERM_USER:MANAGE')")
    public Result<Map<String, Integer>> batchFreeze(@RequestBody BatchFreezeBody body) {
        int n = service.batchFreeze(
            body == null ? null : body.userIds,
            body != null && Boolean.TRUE.equals(body.freeze)
        );
        return Result.ok(Map.of("affected", n));
    }

    /**
     * 以指定员工身份登录。**最高敏感**：仅 PLATFORM_SUPER 可调用（即使 COMPANY_ADMIN 也不行，
     * 防止本公司管理员冒名某员工绕过审计）。三道闸门：
     *  1. URL 粗拦（SecurityConfig: /admin/users/** 非 GET 需 USER:MANAGE）
     *  2. 方法级 @PreAuthorize hasRole('PLATFORM_SUPER')（这里）
     *  3. @RequireSensitiveOp 二次确认（钉钉验证码）
     * 写一条 IMPERSONATE 审计行。
     */
    @PostMapping("/{id}/impersonate")
    @PreAuthorize("hasRole('PLATFORM_SUPER')")
    @RequireSensitiveOp("IMPERSONATE_USER")
    public Result<ImpersonateResp> impersonate(@PathVariable Long id, HttpServletRequest req) {
        Long uid = CurrentUser.userIdOrThrow();
        String username = CurrentUser.username();
        String ua = req.getHeader("User-Agent");
        String ip = extractIp(req);
        ImpersonateResp resp = service.impersonate(uid, username, id, ua, ip);
        return Result.ok(resp);
    }

    /** 给前端筛选 / 表单用：所有角色。 */
    @GetMapping("/_meta/roles")
    @PreAuthorize("hasAuthority('PERM_USER:READ')")
    public Result<List<SysRole>> roles() {
        return Result.ok(service.listAllRoles());
    }

    /** 给前端筛选 / 表单用：部门列表（含 COMPANY + DEPT；前端按 type 过滤）。 */
    @GetMapping("/_meta/orgs")
    @PreAuthorize("hasAuthority('PERM_USER:READ')")
    public Result<List<SysOrg>> orgs() {
        return Result.ok(service.listDepartments());
    }

    private static String extractIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        return req.getRemoteAddr();
    }

    public static class AssignRolesBody {
        public List<Long> roleIds;
    }

    public static class BatchDeptBody {
        public List<Long> userIds;
        public Long deptId;
    }

    public static class BatchRolesBody {
        public List<Long> userIds;
        public List<Long> roleIds;
    }

    public static class BatchFreezeBody {
        public List<Long> userIds;
        public Boolean freeze;
    }
}
