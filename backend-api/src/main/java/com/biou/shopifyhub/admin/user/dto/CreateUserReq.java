package com.biou.shopifyhub.admin.user.dto;

import java.util.List;

/**
 * 新建员工请求。
 *
 * <p>password 为初始明文（必填，>=8 位）；BCrypt 入库 + password_must_change=true 强制首次登录改密。
 * roleIds 为空时不分配角色（可后续编辑分配）。deptId 为空时仅创建用户，不绑组织节点。
 */
public record CreateUserReq(
    String username,
    String employeeNo,
    String password,
    String email,
    String phone,
    String userType,            // STAFF / TEMP；默认 STAFF
    String position,
    String avatarUrl,
    Long defaultTenantId,
    Long deptId,                // 可选：用户所属部门，写到 sys_user_role.org_id（默认角色的 org_id）
    List<Long> roleIds,         // 可选：默认绑定一组角色
    String expiresAt            // ISO datetime，仅 TEMP 必填；STAFF 可空
) {}
