package com.biou.shopifyhub.admin.user.dto;

/**
 * 以指定员工身份登录的响应。
 *
 * <p>仅返回短期 access token（10 分钟），**不**写 refresh cookie；
 * 强制操作员到期必须返回原身份。前端需把当前自己的 access token 暂存（如 sessionStorage），
 * 调本接口后用 targetAccessToken 替换 useAuthStore，跳 /dashboard，并展示「以 X 身份登录中」banner。
 */
public record ImpersonateResp(
    Long targetUserId,
    String targetUsername,
    String targetEmployeeNo,
    String accessToken,
    long expiresInSeconds
) {}
