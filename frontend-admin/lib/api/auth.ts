import { api } from "./client";

export type LoginResp = {
  userId: number;
  username: string;
  employeeNo?: string;
  userType?: "STAFF" | "TEMP";
  passwordMustChange: boolean;
  accessToken: string;
  // refreshToken 改走 httpOnly cookie，不再出现在响应 body
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

  /** 心跳 + 取本人信息（后端会校验 session 仍存在；被踢则 401）。 */
  me: () =>
    api.get<{ userId: number; username: string; sid: string }>("/auth/me", {
      silent: true,
    }),

  /** 在线设备列表 */
  sessions: () => api.get<SessionView[]>("/auth/sessions"),

  /** 一键踢出除本机外的所有设备 */
  kickOthers: () => api.post<{ kicked: number }>("/auth/sessions/kick-others"),

  dingtalkQrcode: (tenant?: string) =>
    api.get<{ oauthUrl: string; state: string }>(
      `/auth/dingtalk/qrcode${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`
    ),
};
