/**
 * API 客户端：自动注入 JWT、统一解包 Result<T>、401 触发清空 store、
 * 默认把后端业务错误冒泡到全局 Toast；调用方可用 { silent:true } 抑制。
 */
import { toast } from "@/components/ui/Toast";

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

export function configureApi(opts: {
  getToken?: () => string | null;
  onUnauthorized?: () => void;
}) {
  if (opts.getToken) getToken = opts.getToken;
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized;
}

type ExtraOpts = { headers?: Record<string, string>; silent?: boolean };

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown; silent?: boolean } = {}
): Promise<T> {
  const { json, headers, silent, ...rest } = init;
  const token = getToken();
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...((headers as Record<string, string>) ?? {}),
  };
  if (token) finalHeaders["Authorization"] = `Bearer ${token}`;

  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, {
      headers: finalHeaders,
      body:
        json !== undefined ? JSON.stringify(json) : (rest as RequestInit).body,
      ...rest,
    });
  } catch (e) {
    const msg = (e as Error).message || "网络异常";
    if (!silent) toast.error(`网络异常：${msg}`);
    throw new ApiError(-1, msg);
  }

  const body: ApiResult<T> = await resp.json().catch(() => ({
    code: -1,
    message: `HTTP ${resp.status}`,
  }));
  if (body.code === 10001) onUnauthorized();
  if (body.code !== 0) {
    if (!silent) toast.error(body.message || `请求失败 (${body.code})`);
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
