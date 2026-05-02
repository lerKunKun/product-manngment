import { api } from "./client";
import type { Page } from "./template";

/**
 * W3-GUIDE-02: 指导文档 (guide_doc) 前端封装。
 * 后端：GuideDocController（Day 3 mini side-task）。
 */

export type GuideDoc = {
  id: number;
  code: string;
  title: string;
  category?: string;
  bodyHtml?: string;
  bodyMarkdown?: string;
  relatedTemplateId?: number;
  showInSagaStep?: string; // INIT / AUTH_DONE / MEDIA / COLLECTIONS / PRODUCTS / GUIDE / THEME / PUBLISH
  status: string; // DRAFT / PUBLISHED / ARCHIVED
  createdBy?: number;
  createdAt: string;
  updatedAt: string;
};

export const SAGA_STEPS = [
  "INIT",
  "AUTH_DONE",
  "MEDIA",
  "COLLECTIONS",
  "PRODUCTS",
  "GUIDE",
  "THEME",
  "PUBLISH",
] as const;
export type SagaStep = (typeof SAGA_STEPS)[number];

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length > 0 ? "?" + parts.join("&") : "";
}

export const guideApi = {
  list: (
    page = 1,
    size = 20,
    params?: { category?: string; status?: string; relatedTemplateId?: number; keyword?: string }
  ) =>
    api.get<Page<GuideDoc>>(
      `/guide-doc${buildQuery({ page, size, ...(params ?? {}) })}`
    ),

  detail: (id: number) => api.get<GuideDoc>(`/guide-doc/${id}`),

  create: (body: Partial<GuideDoc>) => api.post<number>("/guide-doc", body),

  update: (id: number, body: Partial<GuideDoc>) =>
    api.put<void>(`/guide-doc/${id}`, body),

  publish: (id: number, sensitiveToken: string) =>
    api.post<void>(`/guide-doc/${id}/publish`, null, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  remove: (id: number, sensitiveToken: string) =>
    api.del<void>(`/guide-doc/${id}`, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  // ===== 二次确认共享 =====
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", {
      action,
      code,
    }),
};

export const GUIDE_STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-900 border-amber-300",
  PUBLISHED: "bg-emerald-100 text-emerald-900 border-emerald-300",
  ARCHIVED: "bg-zinc-100 text-zinc-500 border-zinc-300",
};
