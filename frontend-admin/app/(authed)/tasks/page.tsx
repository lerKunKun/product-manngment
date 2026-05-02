"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  taskApi,
  type TaskListItem,
  TASK_TYPE_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_STATUS_BADGE,
  isTaskActive,
  relTime,
  durationOf,
} from "@/lib/api/task";
import {
  ErrorBanner,
  LoadingBlock,
  EmptyState,
} from "@/components/ui/StatusBlocks";

/**
 * 任务列表（W2-PUSH-06）。
 *
 * <p>过滤：type / status / storeId。
 * <p>自动刷新：当前页若有 PENDING / RUNNING 行，每 5s 重拉一次；全部终态后停止。
 *    （Day 7 之前 push 已是同步，但仍可能在 RUNNING 时短暂可见；Track C Day 7 切异步后这一项才真正发挥作用。）
 */
const POLL_INTERVAL_MS = 5000;

export default function TasksPage() {
  const sp = useSearchParams();
  const initialType = sp.get("type") ?? "";
  const initialStatus = sp.get("status") ?? "";
  const initialStoreId = sp.get("storeId") ?? "";

  const [records, setRecords] = useState<TaskListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [type, setType] = useState(initialType);
  const [status, setStatus] = useState(initialStatus);
  const [storeId, setStoreId] = useState(initialStoreId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 用 ref 持有"当前过滤参数 + 页码"，避免轮询闭包过期。
  const filtersRef = useRef({ page, type, status, storeId });
  filtersRef.current = { page, type, status, storeId };

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const f = filtersRef.current;
      try {
        const params: { type?: string; status?: string; storeId?: number } = {};
        if (f.type) params.type = f.type;
        if (f.status) params.status = f.status;
        if (f.storeId.trim()) {
          const n = Number(f.storeId);
          if (!isNaN(n)) params.storeId = n;
        }
        const r = await taskApi.list(f.page, size, params);
        setRecords(r?.records ?? []);
        setTotal(r?.total ?? 0);
      } catch (e) {
        if (!silent) {
          setError((e as Error).message);
          setRecords([]);
          setTotal(0);
        }
        // silent 模式下 toast 已上报，保留旧数据
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [size]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, type, status]);

  // 轮询：仅在当前页有活跃任务时启动；终态切走时清掉。
  const hasActive = records.some((r) => isTaskActive(r.status));
  useEffect(() => {
    if (!hasActive) return;
    const t = window.setInterval(() => load(true), POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">任务</h1>
        <div className="text-xs text-muted-foreground">
          {hasActive ? `轮询中 · ${POLL_INTERVAL_MS / 1000}s` : "已停止轮询"}
        </div>
      </div>

      <form onSubmit={search} className="flex flex-wrap gap-2 text-sm">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2"
        >
          {TASK_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
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
          {TASK_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          placeholder="店铺 ID"
          className="w-32 rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          搜索
        </button>
      </form>

      <ErrorBanner message={error} onRetry={() => load()} />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">店铺 ID</th>
              <th className="px-3 py-2 text-left">开始</th>
              <th className="px-3 py-2 text-left">完成</th>
              <th className="px-3 py-2 text-right">耗时</th>
              <th className="px-3 py-2 text-left">触发者</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-3 py-2">
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-2">
                  <EmptyState
                    title="暂无任务"
                    hint="可在产品详情页点击「推送到店铺」创建一条 PRODUCT_PUSH 任务"
                  />
                </td>
              </tr>
            )}
            {records.map((r) => {
              const cls =
                TASK_STATUS_BADGE[r.status] ??
                "bg-zinc-100 text-zinc-700 border-zinc-300";
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2">
                    <span className="rounded border bg-muted px-2 py-0.5 text-xs">
                      {r.type}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "inline-block rounded border px-2 py-0.5 text-xs " + cls
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.storeId ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {relTime(r.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {relTime(r.completedAt)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {durationOf(r)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.triggeredBy ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/tasks/${r.id}`}
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
