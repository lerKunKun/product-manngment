package com.biou.shopifyhub.auth.dto;

/**
 * 登录响应。refreshToken 改走 httpOnly cookie 不再放 body（XSS 加固）。
 */
public record LoginResponse(
    Long userId,
    String username,
    String employeeNo,
    String userType,
    boolean passwordMustChange,
    String accessToken
) {}
