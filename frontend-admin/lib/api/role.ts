import { api } from "./client";

export type SysRole = {
  id: number;
  code: string;
  name: string;
  scope?: string;
  description?: string;
  builtin: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type RoleDetail = {
  role: SysRole;
  permissionCodes: string[];
  userCount: number;
};

export const roleApi = {
  list: () => api.get<SysRole[]>(`/admin/role`),
  get: (id: number) => api.get<RoleDetail>(`/admin/role/${id}`),
  create: (body: { code: string; name: string; scope?: string; description?: string }) =>
    api.post<number>(`/admin/role`, body),
  updatePermissions: (id: number, permissionCodes: string[], sensitiveToken?: string) =>
    api.put<void>(
      `/admin/role/${id}/permissions`,
      { permissionCodes },
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),
  users: (id: number) => api.get<number[]>(`/admin/role/${id}/users`),
  // 二次确认共享端点
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),
};
