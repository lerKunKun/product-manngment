import { api } from "./client";

export type LoginResp = {
  userId: number;
  username: string;
  employeeNo?: string;
  userType?: "STAFF" | "TEMP";
  passwordMustChange: boolean;
  accessToken: string;
  refreshToken: string;
};

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResp>("/auth/login", { username, password }),

  logout: () => api.post<void>("/auth/logout"),

  dingtalkQrcode: (tenant?: string) =>
    api.get<{ oauthUrl: string; state: string }>(
      `/auth/dingtalk/qrcode${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`
    ),
};
