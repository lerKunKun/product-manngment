package com.biou.shopifyhub.admin.user.dto;

/**
 * 编辑员工的可写字段。null 表示「不修改」。
 *
 * <p>**禁改字段**：username（唯一键）、employeeNo、passwordHash（走 reset-password）、status（走 freeze/unfreeze）。
 */
public record UpdateUserReq(
    String email,
    String phone,
    String position,
    String avatarUrl,
    String userType,         // STAFF / TEMP
    String expiresAt,        // ISO datetime；仅 TEMP 有意义
    Long defaultTenantId
) {}
