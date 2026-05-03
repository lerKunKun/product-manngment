package com.biou.shopifyhub.auth.dto;

/**
 * service 层登录返回。
 * - response：发给客户端的 JSON（不含 refreshToken）
 * - refreshToken：由 controller 写入 httpOnly cookie，不进 body
 */
public record LoginResult(
    LoginResponse response,
    String refreshToken
) {}
