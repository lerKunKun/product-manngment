import { api } from "./client";

/**
 * Track AS4：跨店 / 历史快照 diff 客户端。
 *
 * 后端 `/diff/snapshot`（manifest 一层）+ `/diff/snapshot/content`（内容层）。
 * 权限：和 AS1 resync 一致 = `THEME:PULL`。
 */

export type DiffKind = "ADDED" | "REMOVED" | "MODIFIED" | "UNCHANGED";

export type DiffChange = {
  kind: DiffKind | string;
  category: string;
  path: string;
  shaA?: string | null;
  shaB?: string | null;
  sizeA?: number | null;
  sizeB?: number | null;
  contentType?: string | null;
  /** 内容层才有的 unified_diff 文本 */
  diffPreview?: string | null;
};

export type DiffSummary = {
  snapshotAId: number;
  snapshotBId: number;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
};

export type ManifestDiffResult = {
  summary: DiffSummary;
  changes: DiffChange[];
  cached?: boolean;
};

export type ContentDiffItem = {
  path: string;
  kind: string; // TEXT / BINARY / STRUCTURED / MISSING
  preview?: string;
  sizeA?: number | null;
  sizeB?: number | null;
  shaA?: string | null;
  shaB?: string | null;
  contentType?: string | null;
};

export type ContentDiffResult = {
  snapshotAId: number;
  snapshotBId: number;
  items: ContentDiffItem[];
};

export const diffApi = {
  /** Manifest 层 diff（默认 scope=manifest）；后端会用 cache。 */
  diffManifest: (snapshotAId: number, snapshotBId: number) =>
    api.post<ManifestDiffResult>("/diff/snapshot", {
      snapshotAId,
      snapshotBId,
      scope: "manifest",
    }),

  /** GET 版（前端做直链分享时用）。和 POST 等价。 */
  diffManifestGet: (snapshotAId: number, snapshotBId: number) =>
    api.get<ManifestDiffResult>(
      `/diff/snapshot?a=${snapshotAId}&b=${snapshotBId}&scope=manifest`
    ),

  /** 内容层 diff — 给定一组 paths 拿 unified_diff。最多 50 个。 */
  diffContent: (snapshotAId: number, snapshotBId: number, paths: string[]) =>
    api.post<ContentDiffResult>("/diff/snapshot/content", {
      snapshotAId,
      snapshotBId,
      paths,
    }),

  /** 取缓存详情（dev 调试用）。 */
  cacheDetail: (id: number) =>
    api.get<{
      id: number;
      snapshotAId: number;
      snapshotBId: number;
      scope: string;
      computedAt: string;
      resultJson: string;
    }>(`/diff/snapshot/${id}`),
};

/** Group changes by category for the tree view. */
export function groupByCategory(changes: DiffChange[]): Record<string, DiffChange[]> {
  const out: Record<string, DiffChange[]> = {};
  for (const c of changes) {
    const k = c.category || "other";
    (out[k] ||= []).push(c);
  }
  // sort each bucket by path for stable rendering
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => a.path.localeCompare(b.path));
  }
  return out;
}

export const KIND_BADGE: Record<string, string> = {
  ADDED: "bg-emerald-100 text-emerald-900 border-emerald-300",
  REMOVED: "bg-red-100 text-red-900 border-red-300",
  MODIFIED: "bg-amber-100 text-amber-900 border-amber-300",
  UNCHANGED: "bg-zinc-100 text-zinc-700 border-zinc-300",
};
