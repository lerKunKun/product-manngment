import { api } from "./client";

/**
 * AS6 · 模板版本（base_template_version）查询 + metadata 编辑前端封装。
 *
 * <p>**新建版本走 templateApi.uploadVersion**（multipart 含 zip + 钉钉敏感码），
 * 因为 V15 表的 zip_r2_key 是 NOT NULL，模板版本本质是带 zip 的初始化模板。
 * 本模块仅暴露 list / detail / update / remove。
 */

export type TemplateVersion = {
  id: number;
  templateId: number | null;
  templateName?: string | null;
  version: string;
  description?: string | null; // 后端落到 changelog 列
  changelog?: string | null;
  defaultReplaceRulesJson?: string | null;
  rulesCount?: number;
  zipR2Key?: string | null;
  zipBytes?: number | null;
  zipSha256?: string | null;
  status: string; // DRAFT / PUBLISHED / DEPRECATED
  createdBy?: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TemplateVersionPage<T> = {
  records: T[];
  total: number;
  current?: number;
  size?: number;
  pages?: number;
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

export type TemplateVersionUpdateBody = {
  version?: string;
  description?: string;
  defaultReplaceRulesJson?: string;
  status?: string;
};

export const templateVersionApi = {
  list: (page = 1, size = 20, keyword?: string) =>
    api.get<TemplateVersionPage<TemplateVersion>>(
      `/base-template-version${buildQuery({ page, size, keyword })}`
    ),

  detail: (id: number) =>
    api.get<TemplateVersion>(`/base-template-version/${id}`),

  update: (id: number, body: TemplateVersionUpdateBody) =>
    api.put<void>(`/base-template-version/${id}`, body),

  remove: (id: number) =>
    api.del<void>(`/base-template-version/${id}`),
};

export const TEMPLATE_VERSION_STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-900 border-amber-300",
  PUBLISHED: "bg-emerald-100 text-emerald-900 border-emerald-300",
  DEPRECATED: "bg-zinc-100 text-zinc-500 border-zinc-300",
};

/** 写死的示例规则，前端"插入示例规则"按钮塞进 textarea。 */
export const EXAMPLE_REPLACE_RULES_JSON = `{
  "shop_name": {"from": "BIOU", "to": "{{brand}}"},
  "domain": {"from": "biou.com", "to": "{{custom_domain}}"}
}`;
