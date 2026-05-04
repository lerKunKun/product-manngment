import { api } from "./client";

export type StoreItem = {
  id: number;
  tenantId?: number;
  myshopifyDomain: string;
  customDomain?: string;
  brandName?: string;
  tokenType: "cli" | "custom_app" | "oauth";
  status: "ACTIVE" | "DISABLED" | "TOKEN_EXPIRED" | "UNINSTALLED";
  expiresAt?: string;
  isDevStore?: boolean;
  isPartnerCollab?: boolean;
  createdAt: string;
  /** 活跃产品数（store_product 中 status=ACTIVE 的行数） */
  productCount?: number;
  /** Shopify plan_name（V31 拉自 shop.json，每天定时刷） */
  shopifyPlan?: string | null;
  /** 近 30 天 paid 订单 GMV（V31，按 metricsCurrency） */
  gmv?: number | string | null;
  /** 近 30 天 paid 订单数 */
  orderCount?: number | null;
  /** 订单本币 ISO 4217 */
  metricsCurrency?: string | null;
  /** 上次刷新指标时间 */
  metricsFetchedAt?: string | null;
};

export const storeApi = {
  list: (params?: {
    tenantId?: number;
    partnerCollab?: boolean;
    devStore?: boolean;
  }) => {
    const q: string[] = [];
    if (params?.tenantId != null) q.push(`tenantId=${params.tenantId}`);
    if (params?.partnerCollab != null)
      q.push(`partnerCollab=${params.partnerCollab}`);
    if (params?.devStore != null) q.push(`devStore=${params.devStore}`);
    return api.get<StoreItem[]>(`/store${q.length ? "?" + q.join("&") : ""}`);
  },

  connectCustomApp: (req: {
    tenantId: number;
    deptId?: number;
    myshopifyDomain: string;
    brandName?: string;
    accessToken: string;
    isDevStore?: boolean;
    isPartnerCollab?: boolean;
  }) => api.post<{ storeId: number }>("/store/connect/custom-app", req),

  initOAuth: (shopDomain: string, tenantId?: number) =>
    api.post<{ authUrl: string; state: string }>("/oauth/shopify/init", {
      shopDomain,
      tenantId,
    }),

  delete: (id: number, sensitiveToken: string) =>
    api.del<void>(`/store/${id}`, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  /** W3-PV-01: 标记 / 取消合作者池（敏感操作，需 sensitiveToken）。 */
  markPartnerCollab: (id: number, sensitiveToken: string) =>
    api.post<void>(`/store/${id}/mark-partner-collab`, null, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),
  unmarkPartnerCollab: (id: number, sensitiveToken: string) =>
    api.post<void>(`/store/${id}/unmark-partner-collab`, null, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),
  markDevStore: (id: number, sensitiveToken: string) =>
    api.post<void>(`/store/${id}/mark-dev-store`, null, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  /** 与产品 / 指导文档共用的二次确认 endpoint。 */
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>(
      "/auth/sensitive/verify",
      { action, code }
    ),

  /**
   * T10: 健康检查切真——调 GET /store/{id}/test。后端简化版只返回 status / token 是否存在，
   * 未真调 Shopify shop.json（v1.1 待办）。
   */
  healthCheck: async (id: number): Promise<{ ok: boolean; status?: string; message?: string }> => {
    try {
      const r = await api.get<{ storeId: number; status: string; tokenPresent: boolean; healthy: boolean }>(
        `/store/${id}/test`
      );
      if (!r.healthy) {
        return { ok: false, status: r.status, message: `状态：${r.status}` };
      }
      return { ok: true, status: r.status };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  /** T10: 禁用店铺 endpoint（敏感操作）。 */
  disable: (id: number, sensitiveToken: string) =>
    api.post<void>(`/store/${id}/disable`, null, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  /** V31: 手动触发店铺指标（plan + 30d GMV/订单数）刷新。同步调用，可能 30s+。 */
  refreshMetrics: (id: number) =>
    api.post<{ storeId: number; result: "SUCCESS" | "FAILED" | "SKIPPED" }>(
      `/store/${id}/refresh-metrics`,
      null
    ),
};

/** T10：后端已实现批量禁用 / 健康检查 endpoint，开启。 */
export const STORE_DISABLE_AVAILABLE = true;
export const STORE_TEST_ENDPOINT_AVAILABLE = true;
/** T10：后端已实现 POST /asset-snapshot/trigger，开启批量拉资产。 */
export const ASSET_TRIGGER_AVAILABLE = true;
