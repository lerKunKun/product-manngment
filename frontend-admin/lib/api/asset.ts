import { api } from "./client";

/** AS1：店铺最近一次 FULL 同步快照状态值。 */
export type AssetSyncStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "CANCELED";

export type LatestStoreSnapshot = {
  id: number;
  storeId: number;
  snapshotType: "FULL" | string;
  status: AssetSyncStatus;
  fileCount?: number;
  totalBytes?: number;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

/**
 * T10: asset 触发 endpoint。后端 POST /asset-snapshot/trigger 仅插入 PENDING 行，
 * 实际 worker 投递链路待 W2-AST 完整化。
 *
 * <p>AS1：增加 latestForStore / resync 给店铺列表"同步状态徽章 + 重新同步"按钮用。
 */
export const assetApi = {
  trigger: (storeId: number, snapshotType?: string): Promise<number> =>
    api.post<number>("/asset-snapshot/trigger", { storeId, snapshotType }),
  /** T22: 取消 PENDING/RUNNING 快照。 */
  cancel: (id: number): Promise<void> =>
    api.post<void>(`/asset-snapshot/${id}/cancel`, null),
  /** AS1-05：拿某店最近一次 FULL 快照（用于徽章）。无记录返回 latest=null。 */
  latestForStore: (
    storeId: number
  ): Promise<{ latest: LatestStoreSnapshot | null }> =>
    api.get<{ latest: LatestStoreSnapshot | null }>(
      `/asset-snapshot/store/${storeId}/latest`
    ),
  /** AS1-05：重新触发某店全量同步。返回新建的 snapshotId。 */
  resync: (storeId: number): Promise<number> =>
    api.post<number>(`/asset-snapshot/resync?storeId=${storeId}`, null),
};
