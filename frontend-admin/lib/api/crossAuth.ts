import { api } from "./client";

/**
 * 跨公司授权（W3-DS-02）。
 *
 * 后端：CrossCompanyAuthController @ /cross-auth
 *  - GET    /cross-auth?userId&granterCompanyId&status  → list
 *  - POST   /cross-auth                                  → grant（敏感）
 *  - POST   /cross-auth/{id}/revoke                      → revoke（敏感）
 *
 * 敏感操作走通用 X-Sensitive-Token 头：先 /auth/sensitive/request 拿钉钉 6 位码，
 * 再 /auth/sensitive/verify 换 token；与 productApi/recycleApi 的实现一致。
 */
export type CrossAuthGrant = {
  id: number;
  userId: number;
  scopeType: string; // 'COMPANY' | 'ORG' | 'STORE' | ...
  scopeId: number;
  source: string; // 'APPROVAL' | 'INVITATION' | 'MANUAL'
  crossCompany: boolean;
  expiresAt: string;
  revokedAt?: string;
  grantedBy?: number;
  granterCompanyId?: number;
  status: string; // 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  expiringNotifiedAt?: string;
  createdAt: string;
};

export type CrossAuthGrantRequest = {
  userId: number;
  scopeType: string;
  scopeId: number;
  expiresAt: string; // ISO datetime
  grantedBy?: number;
  granterCompanyId?: number;
};

export const crossAuthApi = {
  list: (params?: { userId?: number; granterCompanyId?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.userId) q.set("userId", String(params.userId));
    if (params?.granterCompanyId) q.set("granterCompanyId", String(params.granterCompanyId));
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return api.get<CrossAuthGrant[]>(`/cross-auth${qs ? `?${qs}` : ""}`);
  },
  grant: (req: CrossAuthGrantRequest, sensitiveToken?: string) =>
    api.post<number>(
      "/cross-auth",
      req,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),
  revoke: (id: number, sensitiveToken?: string) =>
    api.post<void>(
      `/cross-auth/${id}/revoke`,
      null,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),

  // ===== 二次确认（共享端点，与 productApi/recycleApi 一致） =====
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),
};

export const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "生效", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  REVOKED: { text: "已撤销", cls: "bg-zinc-100 text-zinc-700 border-zinc-300" },
  EXPIRED: { text: "已过期", cls: "bg-amber-100 text-amber-900 border-amber-300" },
};
