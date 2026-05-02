import { api } from "./client";

export type PurchaseInfo = {
  variantId: number;
  sku: string;
  cost?: number;
  weightG?: number;
  logisticsTag?: string;
  purchaseUrl?: string;
};

export type SkuChangeLog = {
  id: number;
  variantId: number;
  oldSku: string;
  newSku: string;
  actorId: number;
  syncedStoreCount?: number;
  createdAt: string;
};

export const purchaseApi = {
  getByProduct: (productId: number) =>
    api.get<PurchaseInfo[]>(`/product/${productId}/purchase`),
  updateVariant: (variantId: number, body: Partial<PurchaseInfo>) =>
    api.put<void>(`/variant/${variantId}/purchase`, body),
  changeSku: (variantId: number, newSku: string, sensitiveToken?: string) =>
    api.post<void>(
      `/variant/${variantId}/sku`,
      { newSku },
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),
  skuLog: (variantId: number) =>
    api.get<SkuChangeLog[]>(`/variant/${variantId}/sku-log`),
  // 二次确认共享端点
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),
};
