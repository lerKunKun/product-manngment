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

/** GET /admin/role list 项：嵌套 SysRole + 聚合计数。对应后端 SysRoleController.RoleListItem record。 */
export type RoleListItem = {
  role: SysRole;
  permissionCount: number;
  userCount: number;
};

export const roleApi = {
  list: () => api.get<RoleListItem[]>(`/admin/role`),
  get: (id: number) => api.get<RoleDetail>(`/admin/role/${id}`),
  create: (body: { code: string; name: string; scope?: string; description?: string }) =>
    api.post<number>(`/admin/role`, body),
  /** 编辑基本信息（name / description）。code 与 scope 不允许改。 */
  update: (id: number, patch: { name?: string; description?: string }) =>
    api.put<void>(`/admin/role/${id}`, patch),
  remove: (id: number, sensitiveToken?: string) =>
    api.del<void>(
      `/admin/role/${id}`,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),
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
