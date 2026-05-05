package com.biou.shopifyhub.auth.dto;

import java.util.List;

/**
 * 登录响应。refreshToken 改走 httpOnly cookie 不再放 body（XSS 加固）。
 *
 * <p>roles + permissions 在 P1.5 加入，让前端 boot 后立刻能 gate 导航 / 页面，
 * 不必再发一次 /auth/me。后端 enforcement 仍以每次请求实时解析为准（带 Redis cache）。
 */
public record LoginResponse(
    Long userId,
    String username,
    String employeeNo,
    String userType,
    boolean passwordMustChange,
    String accessToken,
    List<String> roles,
    List<String> permissions
) {}
