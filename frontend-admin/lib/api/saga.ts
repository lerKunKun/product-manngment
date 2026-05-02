import { api } from "./client";

/**
 * W3-NEW-10: 一键开店 saga 前端封装。
 *
 * 后端契约（D1 Day 4）：
 *   POST /api/saga/start                            -> { taskId, oauthUrl?, needShopDomainPrompt? }
 *   POST /api/saga/{id}/dev-mock-auth               -> SagaState (advance to AUTH_DONE)
 *   POST /api/saga/{id}/step/run-{media|collections|products}
 *   POST /api/saga/{id}/retry                       -> SagaState
 *   GET  /api/saga/{id}                             -> SagaState
 *   GET  /api/saga/{id}/events                      -> SSE stream（若不可用则降级 3s 轮询）
 */

export type SagaState = {
  taskId: number;
  status: string; // PENDING / RUNNING / SUCCESS / FAILED / CANCELED
  step: string;   // INIT / AUTH_DONE / MEDIA / COLLECTIONS / PRODUCTS / GUIDE / THEME / PUBLISH / SUCCESS
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  context?: Record<string, unknown>;
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
  "SUCCESS",
] as const;
export type SagaStep = (typeof SAGA_STEPS)[number];

export const SAGA_STEP_LABEL: Record<string, string> = {
  INIT: "开始",
  AUTH_DONE: "已授权",
  MEDIA: "上传媒体",
  COLLECTIONS: "创建集合",
  PRODUCTS: "推送产品",
  GUIDE: "推送指南",
  THEME: "部署主题",
  PUBLISH: "发布主题",
  SUCCESS: "完成",
};

export const SAGA_STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-900 border-amber-300",
  RUNNING: "bg-sky-100 text-sky-900 border-sky-300",
  SUCCESS: "bg-emerald-100 text-emerald-900 border-emerald-300",
  FAILED: "bg-red-100 text-red-900 border-red-300",
  CANCELED: "bg-zinc-100 text-zinc-700 border-zinc-300",
};

export type StartRequest = {
  tenantId: number;
  triggeredBy?: number;
  templateId?: number;
  replaceRules?: Record<string, string>;
  productIds?: number[];
  shopDomainHint?: string;
};

export type StartResponse = {
  taskId: number;
  oauthUrl?: string;
  needShopDomainPrompt?: boolean;
};

export const sagaApi = {
  start: (req: StartRequest) =>
    api.post<StartResponse>("/saga/start", req),

  get: (taskId: number) => api.get<SagaState>(`/saga/${taskId}`),

  retry: (taskId: number) => api.post<SagaState>(`/saga/${taskId}/retry`),

  mockAuth: (taskId: number, shopDomain: string, accessToken: string) =>
    api.post<SagaState>(`/saga/${taskId}/dev-mock-auth`, {
      shopDomain,
      accessToken,
    }),

  runStep: (taskId: number, step: "media" | "collections" | "products") =>
    api.post<SagaState>(`/saga/${taskId}/step/run-${step}`),
};

/**
 * 订阅 SSE 进度事件；onError 触发后调用方应降级为轮询。
 * 返回值是 unsubscribe 函数。
 */
export function subscribeSagaEvents(
  taskId: number,
  onEvent: (e: unknown) => void,
  onError: () => void
): () => void {
  const url = `/api/saga/${taskId}/events`;
  let es: EventSource;
  try {
    es = new EventSource(url);
  } catch {
    // 浏览器不支持 / SSR：直接走错误回调
    onError();
    return () => {};
  }
  const safeParse = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  es.onmessage = (msg) => {
    const v = safeParse(msg.data);
    if (v != null) onEvent(v);
  };
  es.addEventListener("progress", (msg: MessageEvent) => {
    const v = safeParse(msg.data);
    if (v != null) onEvent(v);
  });
  es.addEventListener("state", (msg: MessageEvent) => {
    const v = safeParse(msg.data);
    if (v != null) onEvent(v);
  });
  es.onerror = () => {
    es.close();
    onError();
  };
  return () => {
    try {
      es.close();
    } catch {
      /* ignore */
    }
  };
}
