"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  productSnapshotApi,
  humanBytes,
  STATUS_BADGE,
  type ProductSnapshot,
} from "@/lib/api/snapshot";
import { ErrorBanner, LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";

const STATUS_OPTIONS = ["", "PENDING", "RUNNING", "SUCCESS", "FAILED"];

export default function SnapshotsPage() {
  const [records, setRecords] = useState<ProductSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [productExternalId, setProductExternalId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params: { productExternalId?: string; status?: string } = {};
      if (productExternalId.trim()) params.productExternalId = productExternalId.trim();
      if (status) params.status = status;
      const r = await productSnapshotApi.list(page, size, params);
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
  }, [page, status]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">产品快照</h1>
      </div>

      <form onSubmit={search} className="flex flex-wrap gap-2 text-sm">
        <input
          value={productExternalId}
          onChange={(e) => setProductExternalId(e.target.value)}
          placeholder="Shopify 产品 ID"
          className="flex-1 rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
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
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">触发</th>
              <th className="px-3 py-2 text-left">店铺 ID</th>
              <th className="px-3 py-2 text-left">Shopify 产品 ID</th>
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
                    title="暂无产品快照"
                    hint="可在产品详情页点击「立即快照」手动触发"
                  />
                </td>
              </tr>
            )}
            {records.map((r) => {
              const cls =
                STATUS_BADGE[r.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2">
                    <span
                      className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.triggerEvent}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.storeId}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.productExternalId}</td>
                  <td className="px-3 py-2 text-right">{humanBytes(r.totalBytes)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString("zh-CN") : "-"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/snapshots/${r.id}`}
                      className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                    >
                      查看
                    </Link>
                    {r.csvR2Key && (
                      <a
                        href={productSnapshotApi.csvUrl(r.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        下载 CSV
                      </a>
                    )}
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
