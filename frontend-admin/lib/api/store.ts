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
};
