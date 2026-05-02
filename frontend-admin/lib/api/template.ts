import { api } from "./client";

/**
 * W3-TPL-03: 基础模板（base_template）+ 版本（base_template_version）前端封装。
 * 后端：BaseTemplateController（W3-TPL-02）。
 */

export type BaseTemplate = {
  id: number;
  code: string;
  name: string;
  description?: string;
  category?: string;
  coverImageR2Key?: string;
  defaultTemplateVersionId?: number;
  status: string; // DRAFT / PUBLISHED / DEPRECATED
  createdBy?: number;
  createdAt: string;
  updatedAt: string;
};

export type BaseTemplateVersion = {
  id: number;
  templateId: number;
  version: string;
  zipR2Key: string;
  zipBytes?: number;
  zipSha256?: string;
  defaultReplaceRulesJson?: string;
  changelog?: string;
  status: string; // DRAFT / PUBLISHED / DEPRECATED
  createdAt: string;
};

export type Page<T> = {
  records: T[];
  total: number;
  current?: number;
  size?: number;
  pages?: number;
};

export type BaseTemplateDetail = {
  template: BaseTemplate;
  versions: BaseTemplateVersion[];
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

async function getToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const mod = await import("@/lib/auth/store");
    return mod.useAuthStore.getState().accessToken;
  } catch {
    return null;
  }
}

export const templateApi = {
  list: (
    page = 1,
    size = 20,
    params?: { category?: string; status?: string; keyword?: string }
  ) =>
    api.get<Page<BaseTemplate>>(
      `/template${buildQuery({ page, size, ...(params ?? {}) })}`
    ),

  detail: (id: number) => api.get<BaseTemplateDetail>(`/template/${id}`),

  create: (body: { code: string; name: string; description?: string; category?: string }) =>
    api.post<number>("/template", body),

  update: (
    id: number,
    body: { name?: string; description?: string; category?: string; coverImageR2Key?: string }
  ) => api.put<void>(`/template/${id}`, body),

  publish: (id: number, sensitiveToken: string) =>
    api.post<void>(`/template/${id}/publish`, null, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  deprecate: (id: number, sensitiveToken: string) =>
    api.post<void>(`/template/${id}/deprecate`, null, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  remove: (id: number, sensitiveToken: string) =>
    api.del<void>(`/template/${id}`, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  setDefaultVersion: (id: number, versionId: number) =>
    api.post<void>(`/template/${id}/default-version/${versionId}`),

  /**
   * 上传新版本 (multipart) — 走原生 fetch，因为 client.ts 的 api.post 强制 JSON。
   * 需要 X-Sensitive-Token（RequireSensitiveOp("TEMPLATE_VERSION_UPLOAD")）。
   */
  uploadVersion: async (
    id: number,
    version: string,
    file: File,
    sensitiveToken: string,
    opts?: { changelog?: string; defaultReplaceRules?: unknown }
  ): Promise<number> => {
    const fd = new FormData();
    fd.append("version", version);
    fd.append("file", file);
    if (opts?.changelog) fd.append("changelog", opts.changelog);
    if (opts?.defaultReplaceRules !== undefined) {
      fd.append(
        "defaultReplaceRules",
        typeof opts.defaultReplaceRules === "string"
          ? opts.defaultReplaceRules
          : JSON.stringify(opts.defaultReplaceRules)
      );
    }
    const token = await getToken();
    const headers: Record<string, string> = {
      "X-Sensitive-Token": sensitiveToken,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const resp = await fetch(`/api/template/${id}/version`, {
      method: "POST",
      body: fd,
      headers,
    });
    const json = await resp.json().catch(() => ({ code: -1, message: `HTTP ${resp.status}` }));
    if (json.code !== 0) throw new Error(json.message || `请求失败 (${json.code})`);
    return json.data as number;
  },

  // ===== 二次确认共享 =====
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", {
      action,
      code,
    }),
};

export const TEMPLATE_STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-900 border-amber-300",
  PUBLISHED: "bg-emerald-100 text-emerald-900 border-emerald-300",
  DEPRECATED: "bg-zinc-100 text-zinc-500 border-zinc-300",
};
