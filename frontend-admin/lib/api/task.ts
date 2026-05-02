import { api } from "./client";
import type { Page } from "./snapshot";

export type TaskListItem = {
  id: number;
  tenantId?: number;
  type: string; // PRODUCT_PUSH / PRODUCT_PULL / SNAPSHOT / ...
  status: string; // PENDING / RUNNING / SUCCESS / FAILED / PARTIAL / CANCELED
  storeId?: number | null;
  errorMessage?: string | null;
  triggeredBy?: number | null;
  parentTaskId?: number | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type StoreProductRef = {
  id: number;
  storeId: number;
  productId: number;
  shopifyProductId?: string | null;
  shopifyHandle?: string | null;
  status?: string | null;
  lastPushTaskId?: number | null;
  lastPushedAt?: string | null;
};

export type PushConflictRow = {
  id: number;
  taskId: number;
  productId: number;
  storeId: number;
  conflictType: string;
  detailJson?: string | null;
  status: string;
  resolutionPayloadJson?: string | null;
  resolvedBy?: number | null;
  resolvedAt?: string | null;
  createdAt?: string | null;
};

export type TaskDetail = TaskListItem & {
  storeProduct?: StoreProductRef | null;
  pushConflicts?: PushConflictRow[];
};

export type TaskPayloadResp = {
  payloadJson?: string | null;
  payload?: unknown;
  resultJson?: string | null;
  result?: unknown;
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

export const taskApi = {
  list: (
    page = 1,
    size = 20,
    params?: { type?: string; status?: string; storeId?: number }
  ) =>
    api.get<Page<TaskListItem>>(
      `/task${buildQuery({ page, size, ...(params ?? {}) })}`
    ),
  detail: (id: number) => api.get<TaskDetail>(`/task/${id}`),
  payload: (id: number) => api.get<TaskPayloadResp>(`/task/${id}/payload`),
};

export const TASK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部类型" },
  { value: "PRODUCT_PUSH", label: "PRODUCT_PUSH" },
  { value: "PRODUCT_PULL", label: "PRODUCT_PULL" },
  { value: "THEME_PULL", label: "THEME_PULL" },
  { value: "POLICY_PULL", label: "POLICY_PULL" },
  { value: "MENU_PULL", label: "MENU_PULL" },
  { value: "COLLECTION_PULL", label: "COLLECTION_PULL" },
  { value: "SNAPSHOT", label: "SNAPSHOT" },
  { value: "PREVIEW", label: "PREVIEW" },
  { value: "NEW_STORE_SAGA", label: "NEW_STORE_SAGA" },
  { value: "OTHER", label: "OTHER" },
];

export const TASK_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "PENDING", label: "PENDING" },
  { value: "RUNNING", label: "RUNNING" },
  { value: "SUCCESS", label: "SUCCESS" },
  { value: "FAILED", label: "FAILED" },
  { value: "PARTIAL", label: "PARTIAL" },
  { value: "CANCELED", label: "CANCELED" },
];

export const TASK_STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-900 border-amber-300",
  RUNNING: "bg-sky-100 text-sky-900 border-sky-300",
  SUCCESS: "bg-emerald-100 text-emerald-900 border-emerald-300",
  FAILED: "bg-red-100 text-red-900 border-red-300",
  PARTIAL: "bg-orange-100 text-orange-900 border-orange-300",
  CANCELED: "bg-zinc-100 text-zinc-700 border-zinc-300",
};

/** 是否仍在跑（轮询入口判断）。 */
export function isTaskActive(status: string): boolean {
  return status === "PENDING" || status === "RUNNING";
}

/** 相对时间（"5 秒前" / "3 分钟前" / "2 小时前" / "yyyy-MM-dd HH:mm"）。 */
export function relTime(iso?: string | null): string {
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "-";
  const now = Date.now();
  const diff = Math.floor((now - t) / 1000);
  if (diff < 0) return new Date(iso).toLocaleString("zh-CN");
  if (diff < 5) return "刚刚";
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(iso).toLocaleString("zh-CN");
}

/** 计算耗时：started→completed；空值返回 "-"；仍在跑返回 "运行中"。 */
export function durationOf(t: {
  startedAt?: string | null;
  completedAt?: string | null;
  status?: string;
}): string {
  if (!t.startedAt) return "-";
  const start = new Date(t.startedAt).getTime();
  if (isNaN(start)) return "-";
  if (!t.completedAt) {
    if (t.status && isTaskActive(t.status)) return "运行中";
    return "-";
  }
  const end = new Date(t.completedAt).getTime();
  if (isNaN(end)) return "-";
  const ms = end - start;
  if (ms < 0) return "-";
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round(ms / 100) / 10;
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}m${s}s`;
}
