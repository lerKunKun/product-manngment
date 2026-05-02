import { api } from "./client";

export type StoreProductMapping = {
  id: number;
  storeId: number;
  storeBrand: string | null;
  storeDomain: string | null;
  storeStatus: string | null;
  status: string;
  shopifyProductId: string | null;
  shopifyHandle: string | null;
  lastPushTaskId: number | null;
  lastPushedAt: string | null;
  lastPulledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const storeProductApi = {
  listForProduct: (productId: number) =>
    api.get<StoreProductMapping[]>(`/product/${productId}/store-products`),
};

export const STORE_PRODUCT_STATUS: Record<string, { text: string; cls: string }> = {
  NOT_PUSHED: { text: "未推送", cls: "bg-zinc-100 text-zinc-700 border-zinc-300" },
  PUSHING: { text: "推送中", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  ACTIVE: { text: "上架", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  DRAFT: { text: "草稿", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  ARCHIVED: { text: "归档", cls: "bg-zinc-100 text-zinc-500 border-zinc-300" },
  FAILED: { text: "失败", cls: "bg-red-100 text-red-900 border-red-300" },
};
