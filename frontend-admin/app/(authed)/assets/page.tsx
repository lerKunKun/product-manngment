"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  assetSnapshotApi,
  humanBytes,
  STATUS_BADGE,
  type AssetSnapshot,
} from "@/lib/api/snapshot";
import { ErrorBanner, LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";

const TYPE_OPTIONS = ["", "THEME", "POLICY", "MENU", "COLLECTION", "PRODUCT", "FULL"];
const STATUS_OPTIONS = ["", "PENDING", "RUNNING", "SUCCESS", "FAILED"];

export default function AssetsPage() {
  const [records, setRecords] = useState<AssetSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [storeId, setStoreId] = useState("");
  const [snapshotType, setSnapshotType] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params: { storeId?: number; snapshotType?: string; status?: string } = {};
      if (storeId.trim()) {
        const n = Number(storeId);
        if (!isNaN(n)) params.storeId = n;
      }
      if (snapshotType) params.snapshotType = snapshotType;
      if (status) params.status = status;
      const r = await assetSnapshotApi.list(page, size, params);
      setRecords(r?.records ?? []);
      setTotal(r?.total ?? 0);
    } catch (e) {
      setError((e as Error).message);
      setRecords([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, snapshotType, status]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">资产快照</h1>
      </div>

      <form onSubmit={search} className="flex flex-wrap gap-2 text-sm">
        <input
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          placeholder="店铺 ID"
          className="w-32 rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={snapshotType}
          onChange={(e) => {
            setSnapshotType(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t || "全部类型"}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s || "全部状态"}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          搜索
        </button>
      </form>

      <ErrorBanner message={error} onRetry={load} />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">店铺 ID</th>
              <th className="px-3 py-2 text-right">文件数</th>
              <th className="px-3 py-2 text-right">总字节</th>
              <th className="px-3 py-2 text-left">创建时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-2">
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-2">
                  <EmptyState
                    title="暂无资产快照"
                    hint="资产快照将在 webhook 触发或主动拉取后生成"
                  />
                </td>
              </tr>
            )}
            {records.map((r) => {
              const cls = STATUS_BADGE[r.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded border bg-muted px-2 py-0.5 text-xs">
                      {r.snapshotType}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.storeId}</td>
                  <td className="px-3 py-2 text-right">{r.fileCount ?? 0}</td>
                  <td className="px-3 py-2 text-right">{humanBytes(r.totalBytes)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString("zh-CN") : "-"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/assets/${r.id}`}
                      className="rounded border px-2 py-1 text-xs hover:bg-accent"
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            上一页
          </button>
          <span>
            第 {page} / {Math.max(1, Math.ceil(total / size))} 页
          </span>
          <button
            disabled={page * size >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
