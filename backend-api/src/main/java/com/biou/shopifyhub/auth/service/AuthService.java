package com.biou.shopifyhub.auth.service;

import com.biou.shopifyhub.auth.dto.LoginRequest;
import com.biou.shopifyhub.auth.dto.LoginResponse;

public interface AuthService {

    /** 用户名 + 备用密码登录。 */
    LoginResponse loginWithPassword(LoginRequest req, String clientIp);

    /** 登出（加入 JWT 黑名单）。 */
    void logout(String accessToken);
}
