import { api } from "./client";

/**
 * W3-PV-02 / W3-PV-05: preview_theme allocation + worker-build pool API.
 *
 * Backend `POST /preview` is synchronous: it inserts a PENDING row, then drives
 * the worker call inline, then returns the row reflecting the final status —
 * so callers usually see READY (or FAILED) directly. PENDING/BUILDING only
 * surface if the worker is offline / extremely slow; in that case poll
 * {@link previewApi.get} or list via {@link previewApi.listForProduct}.
 */
export type PreviewTheme = {
  id: number;
  tenantId: number;
  sourceProductId: number;
  devStoreId: number;
  shopifyThemeId?: string;
  previewUrl?: string;
  /** PENDING / BUILDING / READY / EXPIRED / FAILED */
  status: string;
  lastAccessedAt?: string;
  expiresAt?: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
};

export const previewApi = {
  allocate: (tenantId: number, sourceProductId: number) =>
    api.post<PreviewTheme>("/preview", { tenantId, sourceProductId }),

  get: (id: number) => api.get<PreviewTheme>(`/preview/${id}`),

  list: (params?: { sourceProductId?: number; devStoreId?: number; status?: string }) => {
    const q: string[] = [];
    if (params?.sourceProductId != null) q.push(`sourceProductId=${params.sourceProductId}`);
    if (params?.devStoreId != null) q.push(`devStoreId=${params.devStoreId}`);
    if (params?.status) q.push(`status=${encodeURIComponent(params.status)}`);
    return api.get<PreviewTheme[]>(`/preview${q.length ? "?" + q.join("&") : ""}`);
  },

  listForProduct: (sourceProductId: number) =>
    api.get<PreviewTheme[]>(`/preview?sourceProductId=${sourceProductId}`),

  markAccessed: (id: number) => api.post<void>(`/preview/${id}/accessed`),
};

export const PREVIEW_STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "等待中", cls: "bg-zinc-100 text-zinc-700 border-zinc-300" },
  BUILDING: { text: "构建中", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  READY: { text: "可预览", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  EXPIRED: { text: "已过期", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  FAILED: { text: "失败", cls: "bg-red-100 text-red-900 border-red-300" },
};
