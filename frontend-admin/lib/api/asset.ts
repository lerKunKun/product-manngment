import { api } from "./client";

/**
 * T10: asset 触发 endpoint。后端 POST /asset-snapshot/trigger 仅插入 PENDING 行，
 * 实际 worker 投递链路待 W2-AST 完整化。
 */
export const assetApi = {
  trigger: (storeId: number, snapshotType?: string): Promise<number> =>
    api.post<number>("/asset-snapshot/trigger", { storeId, snapshotType }),
};
