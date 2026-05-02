import { api } from "./client";

export type PurchaseInfo = {
  variantId: number;
  position?: number;
  sku?: string;
  option1?: string;
  option2?: string;
  price?: number;
  purchaseUrl?: string;
  cost?: number;
  currency?: string;
  grossWeight?: number;
  weightUnit?: string;
  logisticsTags?: string;
  note?: string;
};

export type SkuChangeLog = {
  id: number;
  variantId: number;
  productId?: number;
  oldSku: string;
  newSku: string;
  changedBy?: number;
  confirmedAt?: string;
  syncStatus?: "PENDING" | "SUCCESS" | "PARTIAL" | "FAILED" | string;
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
