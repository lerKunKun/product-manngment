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
  /** 拿某 snapshot 的全部段 manifest（theme/product/shop_settings/...），缺段不报错。 */
  manifests: (snapshotId: number): Promise<SnapshotManifests> =>
    api.get<SnapshotManifests>(`/asset-snapshot/${snapshotId}/manifests`),
};

export type ManifestEntry = {
  relative_path: string;
  sha256: string;
  size?: number;
  content_type?: string | null;
  source_url?: string | null;
};

export type SegmentManifest = {
  version?: number;
  generated_at?: string;
  entries?: ManifestEntry[];
  // 其它字段透传
  [k: string]: unknown;
};

export type SnapshotManifests = {
  snapshotId: number;
  r2Prefix: string;
  status: AssetSyncStatus;
  fileCount?: number;
  totalBytes?: number;
  errorMessage?: string;
  segments: Record<string, SegmentManifest>;
};

/** 把 SyncConsumer 写的 errorMessage 字符串解析成 [{label, detail}, ...]。
 *  格式：`label1: detail1; label2: detail2; ...` */
export function parseSyncErrors(msg?: string | null): { label: string; detail: string }[] {
  if (!msg) return [];
  return msg
    .split(/;\s*/)
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const idx = seg.indexOf(":");
      if (idx === -1) return { label: seg, detail: "" };
      return { label: seg.slice(0, idx).trim(), detail: seg.slice(idx + 1).trim() };
    });
}
