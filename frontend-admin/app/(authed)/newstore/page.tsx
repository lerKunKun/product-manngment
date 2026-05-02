"use client";

/**
 * W3-NEW-10: 一键开店 saga 任务列表
 *
 * 复用 taskApi.list({ type: "NEW_STORE_SAGA" })，5s 自动刷新（仅在有 RUNNING/PENDING 行）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  taskApi,
  type TaskListItem,
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

const POLL_INTERVAL_MS = 5000;

export default function NewStoreListPage() {
  const [records, setRecords] = useState<TaskListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageRef = useRef(page);
  pageRef.current = page;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const r = await taskApi.list(pageRef.current, size, {
          type: "NEW_STORE_SAGA",
        });
        setRecords(r?.records ?? []);
        setTotal(r?.total ?? 0);
      } catch (e) {
        if (!silent) {
          setError((e as Error).message);
          setRecords([]);
          setTotal(0);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [size]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const hasActive = records.some((r) => isTaskActive(r.status));
  useEffect(() => {
    if (!hasActive) return;
    const t = window.setInterval(() => load(true), POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">一键开店</h1>
          <p className="text-xs text-muted-foreground">
            {hasActive
              ? `轮询中 · ${POLL_INTERVAL_MS / 1000}s`
              : "已停止轮询（无活跃 saga）"}
          </p>
        </div>
        <Link
          href="/newstore/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          + 启动新 saga
        </Link>
      </div>

      <ErrorBanner message={error} onRetry={() => load()} />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">任务 ID</th>
              <th className="px-3 py-2 text-left">店铺 ID</th>
              <th className="px-3 py-2 text-left">状态</th>
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
                <td colSpan={8} className="px-3 py-2">
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-2">
                  <EmptyState
                    title="暂无 saga"
                    hint="点击右上角“启动新 saga”创建第一条 NEW_STORE_SAGA 任务"
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
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.storeId ?? "-"}
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
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {relTime(r.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {relTime(r.completedAt)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {durationOf(r)}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.triggeredBy ?? "-"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/newstore/${r.id}`}
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
