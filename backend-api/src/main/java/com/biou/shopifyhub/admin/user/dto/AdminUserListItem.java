package com.biou.shopifyhub.admin.user.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Admin 用户列表/详情统一 DTO。
 *
 * <p>聚合了 sys_user 主表 + 角色集合（id+name）+ 默认部门（取 sys_user_role.org_id 的首条；可空）。
 * 不返回 password_hash 之类的敏感字段。
 */
public record AdminUserListItem(
    Long id,
    String employeeNo,
    String username,
    String email,
    String phone,
    String userType,
    String status,
    LocalDateTime expiresAt,
    String dingtalkUserid,
    Boolean dingtalkBound,
    String avatarUrl,
    String position,
    Long defaultTenantId,
    Long deptId,
    String deptName,
    List<Long> roleIds,
    List<String> roleNames,
    LocalDateTime lastLoginAt,
    String lastLoginIp,
    LocalDateTime createdAt
) {}
