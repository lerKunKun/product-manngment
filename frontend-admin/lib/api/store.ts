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
   * T9: 健康检查兜底——后端没有 /store/{id}/test，
   * 用 list() 找到该 id 是否仍可读作为健康度信号（验证 token 不属于过期 / uninstalled 状态）。
   */
  healthCheck: async (id: number): Promise<{ ok: boolean; status?: string; message?: string }> => {
    try {
      const all = await storeApi.list();
      const s = all.find((x) => x.id === id);
      if (!s) return { ok: false, message: "店铺不存在" };
      if (s.status !== "ACTIVE") {
        return { ok: false, status: s.status, message: `状态：${s.status}` };
      }
      return { ok: true, status: s.status };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  /** T9: 批量禁用占位——后端无 disable endpoint，调用会失败。 */
  disable: (id: number, sensitiveToken: string) =>
    api.post<void>(`/store/${id}/disable`, null, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),
};

/** T9：后端 store.StoreController 暂未实现批量禁用 / 健康检查 endpoint。 */
export const STORE_DISABLE_AVAILABLE = false;
export const STORE_TEST_ENDPOINT_AVAILABLE = false;
/** T9：后端无统一的「触发资产快照」endpoint（asset-snapshot 只有 GET），批量拉资产 disabled。 */
export const ASSET_TRIGGER_AVAILABLE = false;
