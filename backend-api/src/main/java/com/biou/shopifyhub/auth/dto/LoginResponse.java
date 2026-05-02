package com.biou.shopifyhub.auth.dto;

public record LoginResponse(
    Long userId,
    String username,
    String employeeNo,
    String userType,
    boolean passwordMustChange,
    String accessToken,
    String refreshToken
) {}
