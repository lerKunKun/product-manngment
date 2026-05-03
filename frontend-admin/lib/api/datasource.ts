import { api } from "./client";

/**
 * 多租户数据源运行时管理。
 *
 * 后端 controller 实际签名（W1-CORE-01）：
 *   GET    /admin/tenant/datasource          → List<String>（当前已注册 datasource_key）
 *   POST   /admin/tenant/datasource/reload   → Map<String,Integer>（added/skipped/total_active）
 *   POST   /admin/tenant/datasource/{tenantId}/register   → Boolean（无 body，从 DB 重新读取）
 *   DELETE /admin/tenant/datasource/{key}    → Boolean（platform 不允许）
 */

export type ReloadResult = {
  added?: number;
  skipped?: number;
  total_active?: number;
  [k: string]: number | undefined;
};

export const datasourceApi = {
  /** 当前已注册数据源 key 列表。 */
  list: () => api.get<string[]>(`/admin/tenant/datasource`),

  /** 全量重载：补齐缺失的 ACTIVE 数据源。 */
  reload: () => api.post<ReloadResult>(`/admin/tenant/datasource/reload`),

  /** 单租户重载（替换已有连接池）。后端从 DB 读取行配置，前端不需要传 body。 */
  register: (tenantId: number) =>
    api.post<boolean>(
      `/admin/tenant/datasource/${tenantId}/register`,
      null
    ),

  /** 注销 key 对应的数据源（platform 不允许）。 */
  remove: (key: string) =>
    api.del<boolean>(`/admin/tenant/datasource/${encodeURIComponent(key)}`),
};

/* ----------------------------- T26: CRUD ----------------------------- */

export type SysTenantDatasource = {
  id: number;
  tenantId: number;
  tenantCode?: string;
  jdbcUrl: string;
  username: string;
  password?: string; // 后端永远返 "****"
  poolMin?: number;
  poolMax?: number;
  status: "ACTIVE" | "DISABLED";
  createdAt?: string;
};

export type RegisterDatasourceReq = {
  tenantId: number;
  tenantCode: string;
  jdbcUrl: string;
  username: string;
  password: string;
  poolMin?: number;
  poolMax?: number;
};

export const datasourceAdminApi = {
  list: () => api.get<SysTenantDatasource[]>(`/admin/tenant/datasource-admin`),
  create: (body: RegisterDatasourceReq, sensitiveToken?: string) =>
    api.post<number>(
      `/admin/tenant/datasource-admin`,
      body,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),
  remove: (id: number, sensitiveToken?: string) =>
    api.del<void>(
      `/admin/tenant/datasource-admin/${id}`,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),
  update: (
    id: number,
    body: Partial<{ poolMin: number; poolMax: number; status: string }>
  ) => api.put<void>(`/admin/tenant/datasource-admin/${id}`, body),
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", {
      action,
      code,
    }),
};
