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
};

export type ProductImage = {
  id: number;
  productId: number;
  src: string;
  position: number;
  altText?: string;
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
};

function authedFetch(path: string, init: RequestInit = {}) {
  const token =
    typeof window === "undefined"
      ? null
      : (() => {
          try {
            return JSON.parse(localStorage.getItem("shub-auth") ?? "{}").state?.accessToken ?? null;
          } catch {
            return null;
          }
        })();
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

  uploadImage: async (productId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return (await uploadMultipart(`/api/file/product/${productId}/image`, fd)) as {
      imageId: number; src: string; key: string;
    };
  },

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
  docUpload: async (productId: number, file: File, title?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (title) fd.append("title", title);
    return (await uploadMultipart(`/api/product/${productId}/doc/upload`, fd)) as {
      id: number; url: string; key: string; fileName: string; fileSize: number;
    };
  },
  docSaveRich: (productId: number, json: string, title?: string, id?: number) =>
    api.post<{ id: number }>(`/product/${productId}/doc/rich`, { id, title, json }),
  docDelete: (id: number) => api.del<void>(`/doc/${id}`),

  // ===== 二次确认（共享） =====
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),
};
