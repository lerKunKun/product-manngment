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
  dingtalkUserId?: string;
  avatarUrl?: string;
  position?: string;
  companyName?: string;
};

export const userApi = {
  me: () => api.get<Me>("/user/me"),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post<void>("/user/change-password", { oldPassword, newPassword }),
};
