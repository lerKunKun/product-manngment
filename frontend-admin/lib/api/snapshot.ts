import { api } from "./client";

export type AssetSnapshot = {
  id: number;
  tenantId: number;
  storeId: number;
  snapshotType: string; // THEME / POLICY / MENU / COLLECTION / PRODUCT / FULL
  status: string; // PENDING / RUNNING / SUCCESS / FAILED
  r2Prefix?: string;
  fileCount?: number;
  totalBytes?: number;
  errorMessage?: string;
  triggeredBy?: number;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
};

export type AssetFile = {
  id: number;
  snapshotId: number;
  relativePath: string;
  r2Key: string;
  sizeBytes: number;
  contentType?: string;
  sha256?: string;
  downloadedAt?: string;
};

export type ProductSnapshot = {
  id: number;
  tenantId: number;
  storeId: number;
  productExternalId: string;
  productId?: number;
  triggerEvent: string; // WEBHOOK_UPDATE / MANUAL / SCHEDULE / PUSH_DONE
  status: string;
  csvR2Key?: string;
  jsonR2Key?: string;
  diffSummaryJson?: string;
  totalBytes?: number;
  errorMessage?: string;
  createdAt?: string;
  completedAt?: string;
};

export type ProductPriceHistoryRow = {
  id: number;
  storeId: number;
  productExternalId: string;
  variantExternalId?: string;
  price?: number | string;
  compareAtPrice?: number | string;
  oldPrice?: number | string;
  currency?: string;
  changedAt?: string;
  source?: string;
};

export type ProductInventoryHistoryRow = {
  id: number;
  storeId: number;
  productExternalId: string;
  variantExternalId?: string;
  inventoryQuantity?: number;
  oldQuantity?: number;
  changedAt?: string;
  source?: string;
};

export type Page<T> = {
  records: T[];
  total: number;
  pageNo: number;
  pageSize: number;
};

export type AssetSnapshotDetail = AssetSnapshot & { files: AssetFile[] };
export type ProductSnapshotDetail = ProductSnapshot & {
  priceHistory: ProductPriceHistoryRow[];
  inventoryHistory: ProductInventoryHistoryRow[];
};

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length > 0 ? "?" + parts.join("&") : "";
}

export const assetSnapshotApi = {
  list: (
    page = 1,
    size = 20,
    params?: { storeId?: number; snapshotType?: string; status?: string }
  ) =>
    api.get<Page<AssetSnapshot>>(
      `/asset-snapshot${buildQuery({ page, size, ...(params ?? {}) })}`
    ),
  detail: (id: number) => api.get<AssetSnapshotDetail>(`/asset-snapshot/${id}`),
  manifest: (id: number) => api.get<Record<string, unknown>>(`/asset-snapshot/${id}/manifest`),
};

export const productSnapshotApi = {
  list: (
    page = 1,
    size = 20,
    params?: { storeId?: number; productExternalId?: string; status?: string }
  ) =>
    api.get<Page<ProductSnapshot>>(
      `/product-snapshot${buildQuery({ page, size, ...(params ?? {}) })}`
    ),
  detail: (id: number) => api.get<ProductSnapshotDetail>(`/product-snapshot/${id}`),
  manifest: (id: number) => api.get<Record<string, unknown>>(`/product-snapshot/${id}/manifest`),
  csvUrl: (id: number) => `/api/product-snapshot/${id}/csv`,
  manual: (storeId: number, productExternalId: string, tenantId: number) =>
    api.post<{ snapshotId: number; queued: boolean; message?: string }>(
      `/product-snapshot/manual`,
      { storeId, productExternalId, tenantId }
    ),
};

/** Humanize a byte count to e.g. "1.2 MB". Tolerates undefined/null. */
export function humanBytes(n?: number | null): string {
  if (n == null || isNaN(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-900 border-amber-300",
  RUNNING: "bg-sky-100 text-sky-900 border-sky-300",
  SUCCESS: "bg-emerald-100 text-emerald-900 border-emerald-300",
  FAILED: "bg-red-100 text-red-900 border-red-300",
};
