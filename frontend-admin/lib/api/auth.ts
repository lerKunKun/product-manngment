import { api } from "./client";

export type LoginResp = {
  userId: number;
  username: string;
  employeeNo?: string;
  userType?: "STAFF" | "TEMP";
  passwordMustChange: boolean;
  accessToken: string;
  /** 当前用户角色码（如 PLATFORM_SUPER / COMPANY_ADMIN / EMPLOYEE）。
   *  P1.5 后端 LoginResponse 加入；旧后端版本可能为 undefined，前端按空数组兜底。 */
  roles?: string[];
  /** 当前用户实际权限码（已通过角色聚合并去重，如 PRODUCT:READ / STORE:OAUTH）。 */
  permissions?: string[];
  // refreshToken 改走 httpOnly cookie，不再出现在响应 body
};

export type MeResp = {
  userId: number;
  username: string;
  sid: string;
  roles?: string[];
  permissions?: string[];
};

export type SessionView = {
  info: {
    sid: string;
    label: string;
    userAgent: string;
    ip: string;
    loginAt: number;
    lastSeenAt: number;
  };
  current: boolean;
};

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResp>("/auth/login", { username, password }),

  /** 登出。后端会清 cookie + 删 session。 */
  logout: () => api.post<void>("/auth/logout"),

  /** 用 cookie 里的 refresh 拿新 access；通常由 client.ts 的 401 拦截器自动调。 */
  refresh: () => api.post<LoginResp>("/auth/refresh"),

  /** 心跳 + 取本人信息（后端会校验 session 仍存在；被踢则 401）+ RBAC 现状（roles/permissions）。 */
  me: () => api.get<MeResp>("/auth/me", { silent: true }),

  /** 在线设备列表 */
  sessions: () => api.get<SessionView[]>("/auth/sessions"),

  /** 一键踢出除本机外的所有设备 */
  kickOthers: () => api.post<{ kicked: number }>("/auth/sessions/kick-others"),

  dingtalkQrcode: (tenant?: string) =>
    api.get<{ oauthUrl: string; state: string }>(
      `/auth/dingtalk/qrcode${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`
    ),

  /**
   * 个人中心「绑定钉钉」专用：返回的 oauthUrl 跳钉钉 → 钉钉跳回
   * /auth/dingtalk/bind/callback（与登录回调隔离），后端不会切换账号，
   * 只把 unionId/userId/corpId 写入当前登录用户。
   */
  dingtalkBindQrcode: () =>
    api.get<{ oauthUrl: string; state: string }>("/auth/dingtalk/bind/qrcode"),

  /**
   * 解绑钉钉 + 设置新密码（一并提交）。
   * 需 X-Sensitive-Token（action=DINGTALK_UNBIND 走 step-up 验证码）+ 新密码 ≥ 8 位。
   * 不校验旧密码 —— 钉钉登录用户可能根本没用过本地密码。
   */
  dingtalkUnbind: (sensitiveToken: string, newPassword: string) =>
    api.post<void>(
      "/auth/dingtalk/unbind",
      { newPassword },
      { headers: { "X-Sensitive-Token": sensitiveToken } }
    ),

  /** F4：发送敏感操作钉钉验证码（按当前用户的钉钉配置发）。devFallback=true 表示钉钉没发出，dev 模式下码已打到后端控制台。 */
  sendSensitiveCode: (action: string) =>
    api.post<{ devFallback?: boolean }>("/auth/sensitive-code/send", { action }),
  /** F4：核对验证码 → 拿到一次性 sensitiveToken（5min 有效） */
  verifySensitiveCode: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>(
      "/auth/sensitive-code/verify",
      { action, code }
    ),
};
