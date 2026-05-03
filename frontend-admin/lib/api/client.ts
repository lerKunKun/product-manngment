/**
 * API 客户端：自动注入 JWT、统一解包 Result<T>、401 自动 refresh 重放、
 * 默认把后端业务错误冒泡到全局 Toast；调用方可用 { silent:true } 抑制。
 */
import { toast } from "@/components/ui/Toast";
import { formatErrorToast } from "@/lib/i18n/error-codes";

const BASE = "/api";

export type ApiResult<T> = {
  code: number;
  message: string;
  data?: T;
  ts?: string;
};

export class ApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

let getToken: () => string | null = () => null;
let onUnauthorized: () => void = () => {};
let refreshFn: (() => Promise<boolean>) | null = null;

export function configureApi(opts: {
  getToken?: () => string | null;
  onUnauthorized?: () => void;
  refresh?: () => Promise<boolean>;
}) {
  if (opts.getToken) getToken = opts.getToken;
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized;
  if (opts.refresh) refreshFn = opts.refresh;
}

type ExtraOpts = { headers?: Record<string, string>; silent?: boolean };

// 多个并发 401 共享同一次 refresh，避免重复打 /auth/refresh
let pendingRefresh: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  if (!refreshFn) return Promise.resolve(false);
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = refreshFn().finally(() => {
    pendingRefresh = null;
  });
  return pendingRefresh;
}

async function rawFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown; silent?: boolean } = {}
): Promise<{ status: number; body: ApiResult<T> }> {
  const { json, headers, silent: _silent, ...rest } = init;
  const token = getToken();
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...((headers as Record<string, string>) ?? {}),
  };
  if (token) finalHeaders["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(`${BASE}${path}`, {
    headers: finalHeaders,
    body:
      json !== undefined ? JSON.stringify(json) : (rest as RequestInit).body,
    credentials: "include", // 让 httpOnly refresh cookie 随请求发送
    ...rest,
  });

  const body: ApiResult<T> = await resp.json().catch(() => ({
    // 401/403 没拿到 JSON body（中间层 / 旧路径 / 静态错误页）也兜底成 10001 让 auto-refresh 能介入
    code: resp.status === 401 || resp.status === 403 ? 10001 : -1,
    message: `HTTP ${resp.status}`,
  }));
  return { status: resp.status, body };
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown; silent?: boolean; _retry?: boolean } = {}
): Promise<T> {
  const { silent, _retry, ...rest } = init;
  let result;
  try {
    result = await rawFetch<T>(path, rest);
  } catch (e) {
    const msg = (e as Error).message || "网络异常";
    if (!silent) toast.error(`网络异常：${msg}`);
    throw new ApiError(-1, msg);
  }

  const { body } = result;

  // 401 → 尝试 refresh 一次再重放原请求；refresh 失败才走 onUnauthorized
  if (body.code === 10001) {
    if (!_retry && path !== "/auth/refresh" && path !== "/auth/login") {
      const ok = await tryRefresh();
      if (ok) {
        return request<T>(path, { ...init, _retry: true });
      }
    }
    onUnauthorized();
  }

  if (body.code !== 0) {
    if (!silent) toast.error(formatErrorToast(body.code, body.message));
    throw new ApiError(body.code, body.message);
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string, opts?: ExtraOpts) =>
    request<T>(path, { method: "GET", headers: opts?.headers, silent: opts?.silent }),
  post: <T>(path: string, json?: unknown, opts?: ExtraOpts) =>
    request<T>(path, { method: "POST", json, headers: opts?.headers, silent: opts?.silent }),
  put: <T>(path: string, json?: unknown, opts?: ExtraOpts) =>
    request<T>(path, { method: "PUT", json, headers: opts?.headers, silent: opts?.silent }),
  del: <T>(path: string, opts?: ExtraOpts) =>
    request<T>(path, { method: "DELETE", headers: opts?.headers, silent: opts?.silent }),
};
