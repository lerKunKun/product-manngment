import { api } from "./client";

export type Me = {
  id: number;
  employeeNo: string;
  username: string;
  email?: string;
  phone?: string;
  userType: "STAFF" | "TEMP";
  status: string;
  expiresAt?: string;
  passwordMustChange: boolean;
  /** 是否已设过本地密码；false 表示钉钉首登态，前端走「设置密码」流程不要求原密码 */
  hasPassword: boolean;
  dingtalkUserId?: string;
  avatarUrl?: string;
  position?: string;
  companyName?: string;
};

export const userApi = {
  me: () => api.get<Me>("/user/me"),
  /** oldPassword 在「首次设置本地密码」时可省略 */
  changePassword: (newPassword: string, oldPassword?: string) =>
    api.post<void>(
      "/user/change-password",
      oldPassword ? { oldPassword, newPassword } : { newPassword }
    ),
};
