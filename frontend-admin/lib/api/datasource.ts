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
