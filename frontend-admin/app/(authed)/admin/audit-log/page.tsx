"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  LoadingBlock,
  EmptyState,
  ErrorBanner,
} from "@/components/ui/StatusBlocks";
import { auditLogApi, type SysAuditLog } from "@/lib/api/auditLog";
import type { ApiError } from "@/lib/api/client";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Card } from "@/components/ui/Card";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 1000;

type SensitiveFilter = "ALL" | "ONLY" | "EXCLUDE";

const CSV_FIELDS: Array<{ key: keyof SysAuditLog; label: string }> = [
  { key: "id", label: "id" },
  { key: "createdAt", label: "createdAt" },
  { key: "userId", label: "userId" },
  { key: "username", label: "username" },
  { key: "employeeNo", label: "employeeNo" },
  { key: "orgId", label: "orgId" },
  { key: "tenantId", label: "tenantId" },
  { key: "module", label: "module" },
  { key: "action", label: "action" },
  { key: "resourceType", label: "resourceType" },
  { key: "resourceId", label: "resourceId" },
  { key: "requestMethod", label: "requestMethod" },
  { key: "requestUri", label: "requestUri" },
  { key: "responseStatus", label: "responseStatus" },
  { key: "ip", label: "ip" },
  { key: "sensitive", label: "sensitive" },
  { key: "userAgent", label: "userAgent" },
  { key: "requestPayload", label: "requestPayload" },
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function tryPrettyJson(s?: string): string {
  if (!s) return "—";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function ts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export default function AuditLogPage() {
  const toast = useToast();

  const [userId, setUserId] = useState("");
  const [moduleQ, setModuleQ] = useState("");
  const [action, setAction] = useState("");
  const [sensitive, setSensitive] = useState<SensitiveFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ records: SysAuditLog[]; total: number }>({
    records: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const filters = useCallback(() => {
    const sensitiveParam =
      sensitive === "ALL" ? undefined : sensitive === "ONLY";
    return {
      userId: userId ? Number(userId) : undefined,
      module: moduleQ || undefined,
      action: action || undefined,
      sensitive: sensitiveParam,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    };
  }, [userId, moduleQ, action, sensitive, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await auditLogApi.list({
        ...filters(),
        page,
        size: PAGE_SIZE,
      });
      setData({ records: resp.records ?? [], total: resp.total ?? 0 });
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  function onSearch() {
    setPage(1);
    load();
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const resp = await auditLogApi.list({
        ...filters(),
        page: 1,
        size: EXPORT_LIMIT + 1,
      });
      const records = resp.records ?? [];
      if ((resp.total ?? records.length) > EXPORT_LIMIT) {
        toast.warn("数据过多，请缩小过滤范围（>1000 条）");
        return;
      }
      const header = CSV_FIELDS.map((f) => f.label).join(",");
      const rows = records.map((r) =>
        CSV_FIELDS.map((f) => csvEscape(r[f.key])).join(",")
      );
      const csv = "﻿" + [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${ts()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${records.length} 条`);
    } catch {
      /* 全局 toast */
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">审计日志</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            系统操作审计；支持按用户 / 模块 / 动作 / 敏感性筛选；可导出 CSV。
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={exporting || loading}
          className="rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          {exporting ? "导出中…" : "导出 CSV"}
        </button>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="userId">
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              inputMode="numeric"
              placeholder="可选"
              className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="module">
            <input
              value={moduleQ}
              onChange={(e) => setModuleQ(e.target.value)}
              placeholder="可选"
              className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="action">
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="可选"
              className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="敏感性">
            <select
              value={sensitive}
              onChange={(e) => setSensitive(e.target.value as SensitiveFilter)}
              className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="ALL">全部</option>
              <option value="ONLY">仅敏感</option>
              <option value="EXCLUDE">仅非敏感</option>
            </select>
          </Field>
          <Field label="时间范围">
            <DateRangePicker
              from={from || undefined}
              to={to || undefined}
              onChange={(f, t) => {
                setFrom(f ?? "");
                setTo(t ?? "");
              }}
            />
          </Field>
          <button
            onClick={onSearch}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            查询
          </button>
        </div>
      </Card>

      <ErrorBanner message={error} onRetry={load} />

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-left">用户</th>
              <th className="px-3 py-2 text-left">module.action</th>
              <th className="px-3 py-2 text-left">请求</th>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-left">状态码</th>
              <th className="px-3 py-2 text-left">敏感</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7}>
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && data.records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-2">
                  <EmptyState title="暂无审计日志" />
                </td>
              </tr>
            )}
            {!loading &&
              data.records.map((r) => {
                const isOpen = expanded === r.id;
                const userText =
                  r.username || (r.userId != null ? `#${r.userId}` : "—");
                const statusCls =
                  r.responseStatus && r.responseStatus >= 400
                    ? "text-rose-700"
                    : "text-emerald-700";
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                      className="cursor-pointer border-t hover:bg-accent/40"
                    >
                      <td className="px-3 py-2 text-xs">
                        {new Date(r.createdAt).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-3 py-2 text-xs">{userText}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.module || "—"}.{r.action || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <span className="inline-block rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[10px]">
                          {r.requestMethod || "—"}
                        </span>{" "}
                        <span className="break-all">{r.requestUri || "—"}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.ip || "—"}
                      </td>
                      <td className={"px-3 py-2 text-xs " + statusCls}>
                        {r.responseStatus ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.sensitive ? (
                          <span className="inline-block rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-900">
                            敏感
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="space-y-2 text-xs">
                            <div>
                              <span className="font-medium text-muted-foreground">
                                requestPayload：
                              </span>
                              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 font-mono">
                                {tryPrettyJson(r.requestPayload)}
                              </pre>
                            </div>
                            <div>
                              <span className="font-medium text-muted-foreground">
                                userAgent：
                              </span>
                              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border bg-background p-2">
                                {r.userAgent || "—"}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </Card>

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
