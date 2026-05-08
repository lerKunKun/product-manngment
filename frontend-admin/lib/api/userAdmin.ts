import { api } from "./client";
import type { SysOrg } from "./org";
import type { SysRole } from "./role";

export type AdminUserListItem = {
  id: number;
  employeeNo?: string;
  username: string;
  email?: string;
  phone?: string;
  userType?: "STAFF" | "TEMP";
  status?: "ACTIVE" | "FROZEN" | "DELETED" | "EXPIRED";
  expiresAt?: string;
  dingtalkUserid?: string;
  dingtalkBound?: boolean;
  avatarUrl?: string;
  position?: string;
  defaultTenantId?: number;
  deptId?: number;
  deptName?: string;
  roleIds?: number[];
  roleNames?: string[];
  lastLoginAt?: string;
  lastLoginIp?: string;
  createdAt?: string;
  /** true + lastLoginAt 为空时前端派生「待激活」状态。 */
  passwordMustChange?: boolean;
};

export type AdminUserPage = {
  records: AdminUserListItem[];
  total: number;
  size: number;
  current: number;
};

export type CreateUserReq = {
  username: string;
  employeeNo?: string;
  password: string;
  email?: string;
  phone?: string;
  userType?: "STAFF" | "TEMP";
  position?: string;
  avatarUrl?: string;
  defaultTenantId?: number;
  deptId?: number;
  roleIds?: number[];
  expiresAt?: string;
};

export type UpdateUserReq = Partial<{
  email: string;
  phone: string;
  position: string;
  avatarUrl: string;
  userType: "STAFF" | "TEMP";
  expiresAt: string;
  defaultTenantId: number;
}>;

export type ImpersonateResp = {
  targetUserId: number;
  targetUsername: string;
  targetEmployeeNo?: string;
  accessToken: string;
  expiresInSeconds: number;
};

export const userAdminApi = {
  list: (params: {
    keyword?: string;
    status?: string;
    userType?: string;
    deptId?: number;
    /** 子孙过滤：选中节点 + 所有子孙 id 数组，与 deptId 二选一传，同时传时 deptIds 优先。 */
    deptIds?: number[];
    page?: number;
    size?: number;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === "" || v === null) return;
      if (Array.isArray(v)) {
        // Spring 接 List<Long> 用同名重复 key：deptIds=1&deptIds=2&deptIds=3
        for (const it of v) q.append(k, String(it));
      } else {
        q.set(k, String(v));
      }
    });
    return api.get<AdminUserPage>(`/admin/users?${q.toString()}`);
  },

  get: (id: number) => api.get<AdminUserListItem>(`/admin/users/${id}`),

  create: (body: CreateUserReq) =>
    api.post<{ id: number }>(`/admin/users`, body),

  update: (id: number, patch: UpdateUserReq) =>
    api.put<void>(`/admin/users/${id}`, patch),

  remove: (id: number) => api.del<void>(`/admin/users/${id}`),

  freeze: (id: number) => api.post<void>(`/admin/users/${id}/freeze`),
  unfreeze: (id: number) => api.post<void>(`/admin/users/${id}/unfreeze`),

  /** 重置密码：高敏感，需先拿 X-Sensitive-Token。返回临时明文。 */
  resetPassword: (id: number, sensitiveToken: string) =>
    api.post<{ temporaryPassword: string; ttl: string }>(
      `/admin/users/${id}/reset-password`,
      undefined,
      { headers: { "X-Sensitive-Token": sensitiveToken } }
    ),

  assignRoles: (id: number, roleIds: number[]) =>
    api.post<void>(`/admin/users/${id}/assign-roles`, { roleIds }),

  batchUpdateDept: (userIds: number[], deptId: number) =>
    api.post<{ affected: number }>(`/admin/users/batch-update-dept`, {
      userIds,
      deptId,
    }),

  batchUpdateRoles: (userIds: number[], roleIds: number[]) =>
    api.post<{ affected: number }>(`/admin/users/batch-update-roles`, {
      userIds,
      roleIds,
    }),

  batchFreeze: (userIds: number[], freeze: boolean) =>
    api.post<{ affected: number }>(`/admin/users/batch-freeze`, {
      userIds,
      freeze,
    }),

  /** Impersonate：高敏感，需先拿 X-Sensitive-Token（action=IMPERSONATE_USER）。 */
  impersonate: (id: number, sensitiveToken: string) =>
    api.post<ImpersonateResp>(
      `/admin/users/${id}/impersonate`,
      undefined,
      { headers: { "X-Sensitive-Token": sensitiveToken } }
    ),

  meta: {
    roles: () => api.get<SysRole[]>(`/admin/users/_meta/roles`),
    orgs: () => api.get<SysOrg[]>(`/admin/users/_meta/orgs`),
  },

  /** 共享敏感操作端点（前端通常已通过 authApi 发；这里提供模块自带入口便于复用）。 */
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>(
      "/auth/sensitive/verify",
      { action, code }
    ),
};
