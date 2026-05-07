"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Folder } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/StatusBlocks";
import {
  assetApi,
  parseSyncErrors,
  type AssetSyncStatus,
  type LatestStoreSnapshot,
  type SnapshotManifests,
} from "@/lib/api/asset";

const STATUS_BADGE: Record<AssetSyncStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900 border-amber-300",
  RUNNING: "bg-sky-100 text-sky-900 border-sky-300",
  SUCCESS: "bg-emerald-100 text-emerald-900 border-emerald-300",
  PARTIAL: "bg-amber-100 text-amber-900 border-amber-400",
  FAILED: "bg-red-100 text-red-900 border-red-300",
  CANCELED: "bg-zinc-100 text-zinc-700 border-zinc-300",
};

const SEGMENT_LABEL: Record<string, string> = {
  theme: "主题",
  product: "产品",
  shop_settings: "店铺设置",
  metafields: "Metafields",
  files: "文件库",
  menu: "菜单",
  policy: "政策",
  collection: "集合",
};

function humanBytes(n?: number | null): string {
  if (n == null || isNaN(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 同步详情弹层：徽章点击触发，展示
 *  1. 头部状态摘要（status / file_count / total_bytes / 时间）
 *  2. 失败子任务列表（解析 errorMessage 按 ;,: 分段）
 *  3. 各段 manifest 文件清单（theme / product / shop_settings / metafields / files）
 */
export function SyncDetailDialog({
  open,
  onClose,
  snapshot,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: LatestStoreSnapshot | null;
}) {
  const [manifests, setManifests] = useState<SnapshotManifests | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !snapshot?.id) {
      setManifests(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    assetApi
      .manifests(snapshot.id)
      .then((d) => setManifests(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, snapshot?.id]);

  if (!snapshot) return null;
  const errors = parseSyncErrors(snapshot.errorMessage);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`同步详情 #${snapshot.id}`}
      className="max-w-2xl"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          关闭
        </button>
      }
    >
      <div className="space-y-4 text-sm">
        {/* 状态摘要 */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[snapshot.status]}`}
          >
            {snapshot.status === "SUCCESS" ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : snapshot.status === "PARTIAL" || snapshot.status === "FAILED" ? (
              <AlertTriangle className="h-3 w-3" />
            ) : null}
            {snapshot.status}
          </span>
          <span className="text-xs text-muted-foreground">
            文件 {snapshot.fileCount ?? 0} · {humanBytes(snapshot.totalBytes)}
          </span>
          {snapshot.completedAt && (
            <span className="text-xs text-muted-foreground">
              完成 {new Date(snapshot.completedAt).toLocaleString("zh-CN")}
            </span>
          )}
        </div>

        {/* 失败子任务 */}
        {errors.length > 0 && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5" />
              失败子任务（{errors.length}）
            </div>
            <ul className="space-y-1.5 text-xs">
              {errors.map((e, i) => (
                <li key={i} className="rounded bg-white/60 p-2">
                  <div className="font-mono font-medium text-amber-900">{e.label}</div>
                  <div className="mt-0.5 break-all text-amber-800">{e.detail}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* manifest 段列表 */}
        <section className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-semibold">
              <Folder className="h-3.5 w-3.5" /> 文件清单
            </span>
            {manifests?.r2Prefix && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {manifests.r2Prefix}
              </span>
            )}
          </div>
          <div className="p-3">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner /> 读取 manifest...
              </div>
            ) : error ? (
              <div className="text-xs text-destructive">{error}</div>
            ) : !manifests ? null : Object.keys(manifests.segments).length === 0 ? (
              <div className="text-xs text-muted-foreground">
                没有任何段成功写入 manifest（5 个 pull 全失败 / 还在 RUNNING / R2 中找不到该 prefix）
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(manifests.segments).map(([seg, data]) => {
                  const entries = (data.entries as { relative_path: string; sha256: string; size?: number }[] | undefined) ?? [];
                  return (
                    <details key={seg} className="rounded border bg-muted/20" open={entries.length <= 8}>
                      <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-medium hover:bg-muted/40">
                        <span className="inline-flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {SEGMENT_LABEL[seg] ?? seg} ({entries.length} 个文件)
                        </span>
                      </summary>
                      <ul className="max-h-64 space-y-0.5 overflow-auto border-t bg-background p-2 font-mono text-[11px]">
                        {entries.length === 0 ? (
                          <li className="text-muted-foreground">（空）</li>
                        ) : (
                          entries.map((e, i) => (
                            <li key={i} className="flex items-center gap-2">
                              <span className="flex-1 truncate" title={e.relative_path}>
                                {e.relative_path}
                              </span>
                              <span className="text-muted-foreground">{humanBytes(e.size)}</span>
                              <span className="text-[9px] text-muted-foreground" title={e.sha256}>
                                {e.sha256?.slice(0, 7)}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <p className="text-[11px] text-muted-foreground">
          字节内容存在 R2 CAS（按 sha256 去重），通过 MinIO 控制台 (http://localhost:9001) bucket
          shopify-assets-dev 可直接查看。
        </p>
      </div>
    </Dialog>
  );
}
