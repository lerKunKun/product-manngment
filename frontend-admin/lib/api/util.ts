import { api } from "./client";

export type UsdCnyRate = {
  rate: number | null;
  fetchedAt: number;
  source: string;
  error?: string;
};

export const utilApi = {
  /** 取 USD→CNY 汇率（后端代理 + Redis 1h 缓存）。失败时 rate=null。 */
  usdCnyRate: () => api.get<UsdCnyRate>("/util/usd-cny-rate", { silent: true }),
};
