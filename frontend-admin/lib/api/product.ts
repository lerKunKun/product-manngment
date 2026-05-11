import { api } from "./client";

export type Product = {
  id: number;
  ownerCompanyId: number;
  ownerDeptId?: number;
  handle: string;
  title: string;
  bodyHtml?: string;
  vendor?: string;
  productCategory?: string;
  type?: string;
  tags?: string;
  published?: boolean;
  seoTitle?: string;
  seoDescription?: string;
  /** Shopify product.template_suffix — product.<suffix>.liquid 模板匹配（V40） */
  templateSuffix?: string | null;
  status: "active" | "draft" | "archived";
  createdAt?: string;
  updatedAt?: string;
};

/**
 * 列表页卡片化字段（仅 list 端点返回，详情端点不带）。
 * 后端在 service 层一次性 batch 查 product_image / product_variant /
 * store_product 后拼装，避免 N+1。
 */
export type ProductListItem = Product & {
  /** position=1 / position 最小的产品图 src；无图为 null */
  mainImageUrl?: string | null;
  /** 所有 variant 中最低 price；无 variant 为 null。后端类型 BigDecimal，序列化常见为 string，也可能是 number */
  price?: number | string | null;
  /** store_product.status='ACTIVE' 的店铺数；从未推送/全部失败为 0 */
  shelfStores?: number;
};

export type ProductVariant = {
  id: number;
  productId: number;
  sku?: string;
  position: number;
  option1?: string;
  option2?: string;
  option3?: string;
  price: number | string;
  compareAtPrice?: number | string;
  inventoryQty?: number;
  inventoryPolicy: "deny" | "continue";
  grams?: number | string;
  weightUnit?: string;
  barcode?: string;
  /** 变体专属图（schema 里有 variant_image 字段，但 W1 一般不填，回退到产品主图） */
  variantImage?: string;
};

export type ProductImage = {
  id: number;
  productId: number;
  src: string;
  position: number;
  altText?: string;
  // F2 新增：生命周期 + 标签 / 备注 / 缩略图
  tags?: string[];
  remark?: string;
  localPath?: string | null;
  r2Key?: string | null;
  r2Status?: "PENDING" | "UPLOADING" | "DONE" | "FAILED";
  r2Error?: string | null;
  thumbnailUrl?: string | null;
  mediaType?: "IMAGE" | "VIDEO";
};

export type FileScanStatus = {
  scanned: boolean;
  status: "NOT_SCANNED" | "CLEAN" | "INFECTED" | "FAILED";
  message: string;
};

export type ProductOption = {
  id: number;
  productId: number;
  name: string;
  position: number;
  linkedTo?: string;
};

export type ProductMetafield = {
  id: number;
  productId: number;
  namespace: string;
  key: string;
  value?: string;
  type?: string;
};

export type ProductDetail = {
  product: Product;
  variants: ProductVariant[];
  images: ProductImage[];
};

export type ProductListPage = {
  records: ProductListItem[];
  total: number;
  page: number;
  size: number;
};

export type ExternalLink = {
  id: number;
  productId: number;
  kind: "AD" | "BENCHMARK" | "MATERIAL";
  url: string;
  note?: string;
  createdAt?: string;
};

export type PurchaseRow = {
  variantId: number;
  position: number;
  sku?: string;
  option1?: string;
  option2?: string;
  price: number | string;
  purchaseUrl?: string;
  cost?: number | string;
  currency?: string;
  grossWeight?: number | string;
  weightUnit?: string;
  logisticsTags?: string;
  note?: string;
};

export type ProductDoc = {
  id: number;
  productId: number;
  type: "RICH_TEXT" | "FILE";
  richTextJson?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileMime?: string;
  title?: string;
  createdAt?: string;
  // F2 新增
  tags?: string[];
  remark?: string;
  localPath?: string | null;
  r2Status?: "PENDING" | "UPLOADING" | "DONE" | "FAILED";
  r2Error?: string | null;
  scanStatus?: "NOT_SCANNED" | "CLEAN" | "INFECTED" | "FAILED";
};

/**
 * 拿 access token：走 zustand store 的内存值。
 *
 * 这个 helper 之前从 localStorage 的 `shub-auth` 读 `state.accessToken`，但 store 配的
 * `partialize: (s) => ({ user: s.user })` 故意只持久化 user、access token 仅内存（防 XSS），
 * 所以 localStorage 那条永远拿不到 token —— multipart 上传请求被无声地不带 Authorization
 * 发出去，后端 SecurityContext 为空，@PreAuthorize 拒时被 ExceptionTranslationFilter
 * 当成 anonymous 返 401，前端看到的是「未登录或登录已过期」。
 *
 * 用动态 import 避免顶部循环依赖（store.ts 反过来 configureApi("./client")）。
 */
async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const mod = await import("@/lib/auth/store");
    return mod.useAuthStore.getState().accessToken;
  } catch {
    return null;
  }
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(path, { ...init, headers });
}

async function uploadMultipart(path: string, fd: FormData) {
  const resp = await authedFetch(path, { method: "POST", body: fd });
  const body = await resp.json();
  if (body.code !== 0) throw new Error(body.message);
  return body.data;
}

export const productApi = {
  list: (page = 1, size = 20, keyword = "", status = "", ownerCompanyId?: number) => {
    const q = new URLSearchParams();
    q.set("page", String(page));
    q.set("size", String(size));
    if (keyword) q.set("keyword", keyword);
    if (status) q.set("status", status);
    if (ownerCompanyId) q.set("ownerCompanyId", String(ownerCompanyId));
    return api.get<ProductListPage>(`/product?${q.toString()}`);
  },

  detail: (id: number) => api.get<ProductDetail>(`/product/${id}`),
  create: (p: Partial<Product>) => api.post<{ id: number }>("/product", p),
  update: (id: number, patch: Partial<Product>) => api.put<void>(`/product/${id}`, patch),
  delete: (id: number, sensitiveToken: string) =>
    api.del<void>(`/product/${id}`, { headers: { "X-Sensitive-Token": sensitiveToken } }),

  batchDelete: (ids: number[], sensitiveToken: string) =>
    api.post<{ deleted: number }>("/product/batch/delete", { ids }, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),
  batchStatus: (ids: number[], status: "active" | "draft" | "archived") =>
    api.post<{ updated: number }>("/product/batch/status", { ids, status }),

  exportUrl: (ownerCompanyId?: number) =>
    `/api/product/export${ownerCompanyId ? `?ownerCompanyId=${ownerCompanyId}` : ""}`,

  /**
   * F3 子轨道 — 浏览器下载 CSV。
   *
   * 用 fetch + blob 而不是 window.location.href，因为 access token 在 Authorization
   * header 里（不是 cookie），原生 download 无法附加 header。
   *
   * - mode='all'：按列表筛选条件全量导出（沿用 keyword/status/ownerCompanyId）
   * - mode='selected'：按 ids 顺序导出（后端上限 1000）
   *
   * @returns 触发完下载（含错误 toast）。失败抛错，调用方可清 loading。
   */
  exportCsv: async (params: {
    mode: "all" | "selected";
    ids?: number[];
    keyword?: string;
    status?: string;
    ownerCompanyId?: number;
  }) => {
    const q = new URLSearchParams();
    q.set("mode", params.mode);
    if (params.mode === "selected") {
      if (!params.ids || params.ids.length === 0) {
        throw new Error("ids 不能为空");
      }
      q.set("ids", params.ids.join(","));
    } else {
      if (params.keyword) q.set("keyword", params.keyword);
      if (params.status) q.set("status", params.status);
      if (params.ownerCompanyId) q.set("ownerCompanyId", String(params.ownerCompanyId));
    }

    const resp = await authedFetch(`/api/product/export?${q.toString()}`, {
      method: "GET",
    });
    if (!resp.ok) {
      // 后端 4xx 业务错误体是 JSON
      let msg = `HTTP ${resp.status}`;
      try {
        const j = await resp.json();
        if (j && j.message) msg = j.message;
      } catch {
        // 非 JSON：保持原始 status
      }
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products_export_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /** @deprecated F2：保留旧端点用于 TipTap 富文本上传；产品媒体走 uploadImageV2 */
  uploadImage: async (productId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return (await uploadMultipart(`/api/file/product/${productId}/image`, fd)) as {
      imageId: number; src: string; key: string;
    };
  },

  /**
   * F2 新版图片 / 视频上传：先存本地 → 后台 worker 推 R2。
   * 立即返回 {id, r2Status:'PENDING'}，前端轮询 imageList 直到 DONE。
   */
  uploadImageV2: async (
    productId: number,
    file: File,
    tags: string[],
    remark?: string,
    position?: number
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tags", JSON.stringify(tags));
    if (remark) fd.append("remark", remark);
    if (position !== undefined) fd.append("position", String(position));
    return (await uploadMultipart(`/api/product/${productId}/image/upload`, fd)) as {
      id: number;
      r2Status: "PENDING" | "UPLOADING" | "DONE" | "FAILED";
      mediaType: "IMAGE" | "VIDEO";
    };
  },

  /** F2：拉产品所有图片 / 视频（含 r2_status 等新字段，前端轮询用） */
  imageList: (productId: number) =>
    api.get<ProductImage[]>(`/product/${productId}/image`),

  uploadDocImage: async (productId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("productId", String(productId));
    return (await uploadMultipart(`/api/file/upload-doc`, fd)) as { url: string; key: string };
  },

  // ===== 变体 =====
  variantCreate: (productId: number, v: Partial<ProductVariant>) =>
    api.post<{ id: number }>(`/product/${productId}/variant`, v),
  variantUpdate: (id: number, patch: Partial<ProductVariant>) =>
    api.put<void>(`/variant/${id}`, patch),
  variantDelete: (id: number) => api.del<void>(`/variant/${id}`),

  changeSku: (variantId: number, newSku: string, sensitiveToken: string) =>
    api.post<{ logId: number }>(`/variant/${variantId}/sku`, { newSku }, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  // ===== Options（用于变体表动态列头）=====
  optionList: (productId: number) =>
    api.get<ProductOption[]>(`/product/${productId}/option`),

  // ===== Metafields =====
  metafieldList: (productId: number) =>
    api.get<ProductMetafield[]>(`/product/${productId}/metafield`),
  metafieldCreate: (productId: number, m: Partial<ProductMetafield>) =>
    api.post<{ id: number }>(`/product/${productId}/metafield`, m),
  metafieldUpdate: (id: number, patch: Partial<ProductMetafield>) =>
    api.put<void>(`/metafield/${id}`, patch),
  metafieldDelete: (id: number) => api.del<void>(`/metafield/${id}`),

  // ===== 图片删除 / 重排序（不删 R2，仅 DB）=====
  imageDelete: (imageId: number) => api.del<void>(`/product-image/${imageId}`),
  imageReorder: (productId: number, ids: number[]) =>
    api.post<{ updated: number }>(`/product/${productId}/image/reorder`, { ids }),

  // ===== 外部链接 =====
  linkList: (productId: number) =>
    api.get<ExternalLink[]>(`/product/${productId}/external-link`),
  linkCreate: (productId: number, l: Partial<ExternalLink>) =>
    api.post<{ id: number }>(`/product/${productId}/external-link`, l),
  linkUpdate: (id: number, patch: Partial<ExternalLink>) =>
    api.put<void>(`/external-link/${id}`, patch),
  linkDelete: (id: number) => api.del<void>(`/external-link/${id}`),

  // ===== 采购信息 =====
  purchaseList: (productId: number) =>
    api.get<PurchaseRow[]>(`/product/${productId}/purchase`),
  purchaseUpsert: (variantId: number, info: Partial<PurchaseRow>) =>
    api.put<void>(`/variant/${variantId}/purchase`, info),

  // ===== 媒体 / 需求文档 =====
  docList: (productId: number) =>
    api.get<ProductDoc[]>(`/product/${productId}/doc`),
  docUpload: async (
    productId: number,
    file: File,
    tags: string[],
    remark?: string,
    title?: string
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tags", JSON.stringify(tags));
    if (remark) fd.append("remark", remark);
    if (title) fd.append("title", title);
    return (await uploadMultipart(`/api/product/${productId}/doc/upload`, fd)) as {
      id: number;
      r2Status: "PENDING" | "UPLOADING" | "DONE" | "FAILED";
      scanStatus: "NOT_SCANNED" | "CLEAN" | "INFECTED" | "FAILED";
      fileName: string;
      fileSize: number;
    };
  },

  /** F2：占位扫描状态接口，供下载前调用 */
  getScanStatus: (type: "image" | "video" | "doc", id: number) =>
    api.get<FileScanStatus>(`/file/${type}/${id}/scan-status`),
  docSaveRich: (productId: number, json: string, title?: string, id?: number) =>
    api.post<{ id: number }>(`/product/${productId}/doc/rich`, { id, title, json }),
  docDelete: (id: number) => api.del<void>(`/doc/${id}`),

  // ===== 二次确认（共享） =====
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),
};
