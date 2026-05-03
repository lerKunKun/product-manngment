package com.biou.shopifyhub.auth.service;

import com.biou.shopifyhub.auth.dto.LoginRequest;
import com.biou.shopifyhub.auth.dto.LoginResult;
import com.biou.shopifyhub.core.security.SessionInfo;

import java.util.List;

public interface AuthService {

    /** 用户名 + 备用密码登录。返回 access + refresh（refresh 由 controller 写 cookie）。 */
    LoginResult loginWithPassword(LoginRequest req, String clientIp, String userAgent);

    /** 登出：删 session、access 入黑名单、清 refresh cookie 由 controller 处理。 */
    void logout(String accessToken, Long userId, String sid);

    /** 用 refresh token 换新 access；rotate sid（旧 session 删除、新 session 建立）。 */
    LoginResult refresh(String refreshToken, String clientIp, String userAgent);

    /** 当前用户的全部在线 session（按 lastSeen 倒序），current 标记当前 sid。 */
    List<SessionView> listSessions(long userId, String currentSid);

    /** 踢掉除 currentSid 之外的所有设备，返回被踢条数。 */
    long kickOthers(long userId, String currentSid);

    /** UI 用：sessionInfo + 是否本机标记 */
    record SessionView(SessionInfo info, boolean current) {}
}
