"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  LoadingBlock,
  EmptyState,
  ErrorBanner,
} from "@/components/ui/StatusBlocks";
import {
  notificationLogApi,
  type NotificationLog,
} from "@/lib/api/notificationLog";
import type { ApiError } from "@/lib/api/client";

const PAGE_SIZE = 50;

const CHANNEL_OPTIONS = [
  { v: "", label: "全部渠道" },
  { v: "DINGTALK", label: "钉钉" },
  { v: "EMAIL", label: "邮件" },
  { v: "INAPP", label: "站内" },
];

const STATUS_OPTIONS = [
  { v: "", label: "全部状态" },
  { v: "PENDING", label: "待发送" },
  { v: "SENT", label: "已发送" },
  { v: "FAILED", label: "失败" },
  { v: "SKIPPED", label: "已跳过" },
];

const STATUS_BADGE: Record<string, string> = {
  SENT: "bg-emerald-100 text-emerald-900 border-emerald-300",
  FAILED: "bg-rose-100 text-rose-900 border-rose-300",
  PENDING: "bg-amber-100 text-amber-900 border-amber-300",
  SKIPPED: "bg-zinc-100 text-zinc-700 border-zinc-300",
};

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

export default function NotificationLogPage() {
  const toast = useToast();

  const [eventCode, setEventCode] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    records: NotificationLog[];
    total: number;
  }>({ records: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [stats, setStats] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await notificationLogApi.list({
        eventCode: eventCode || undefined,
        channel: channel || undefined,
        status: status || undefined,
        userId: userId ? Number(userId) : undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        page,
        size: PAGE_SIZE,
      });
      setData({ records: resp.records ?? [], total: resp.total ?? 0 });
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [eventCode, channel, status, userId, from, to, page]);

  const loadStats = useCallback(async () => {
    try {
      const r = todayRange();
      const s = await notificationLogApi.stats(r.from, r.to);
      setStats(s ?? {});
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  async function retry(id: number) {
    try {
      await notificationLogApi.retry(id);
      toast.success(`#${id} 重试已触发`);
      load();
      loadStats();
    } catch {
      /* 全局 toast */
    }
  }

  function onSearch() {
    setPage(1);
    load();
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">通知日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看通知投递记录，支持按渠道 / 状态 / 用户筛选；失败可手动重试。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="今日 SENT" value={stats.SENT ?? 0} cls="text-emerald-700" />
        <StatCard label="今日 FAILED" value={stats.FAILED ?? 0} cls="text-rose-700" />
        <StatCard label="今日 PENDING" value={stats.PENDING ?? 0} cls="text-amber-700" />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-background p-3">
        <Field label="event_code">
          <input
            value={eventCode}
            onChange={(e) => setEventCode(e.target.value)}
            placeholder="可选"
            className="w-40 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="渠道">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {CHANNEL_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="状态">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="userId">
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            inputMode="numeric"
            placeholder="可选"
            className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="开始时间">
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="结束时间">
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <button
          onClick={onSearch}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          查询
        </button>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-left">用户</th>
              <th className="px-3 py-2 text-left">event_code</th>
              <th className="px-3 py-2 text-left">渠道</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">尝试</th>
              <th className="px-3 py-2 text-left">下次重试</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8}>
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && data.records.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-2">
                  <EmptyState title="暂无通知日志" />
                </td>
              </tr>
            )}
            {!loading &&
              data.records.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                      className="cursor-pointer border-t hover:bg-accent/40"
                    >
                      <td className="px-3 py-2 text-xs">
                        {new Date(r.createdAt).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.userId}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.eventCode}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs">
                          {r.channel}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            "inline-block rounded border px-2 py-0.5 text-xs " +
                            (STATUS_BADGE[r.status] ?? STATUS_BADGE.SKIPPED)
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.attemptCount}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.nextRetryAt
                          ? new Date(r.nextRetryAt).toLocaleString("zh-CN")
                          : "—"}
                      </td>
                      <td
                        className="px-3 py-2 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.status === "FAILED" && (
                          <button
                            onClick={() => retry(r.id)}
                            className="rounded border px-2 py-1 text-xs hover:bg-accent"
                          >
                            重试
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="space-y-2 text-xs">
                            <div>
                              <span className="font-medium text-muted-foreground">
                                subject：
                              </span>
                              <span>{r.subject || "—"}</span>
                            </div>
                            <div>
                              <span className="font-medium text-muted-foreground">
                                bodyText：
                              </span>
                              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border bg-background p-2">
                                {r.bodyText || "—"}
                              </pre>
                            </div>
                            {r.errorMsg && (
                              <div>
                                <span className="font-medium text-rose-700">
                                  errorMsg：
                                </span>
                                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 p-2 text-rose-900">
                                  {r.errorMsg}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">共 {data.total} 条</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-xs">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  cls,
}: {
  label: string;
  value: number;
  cls: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-1 text-2xl font-semibold " + cls}>{value}</div>
    </div>
  );
}
