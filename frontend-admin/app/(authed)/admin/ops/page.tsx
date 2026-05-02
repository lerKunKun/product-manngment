"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { LoadingBlock, EmptyState, ErrorBanner } from "@/components/ui/StatusBlocks";
import { auditArchiveApi, type AuditArchiveLog } from "@/lib/api/auditArchive";
import { ApiError } from "@/lib/api/client";

const STATUS_VARIANT: Record<AuditArchiveLog["status"], BadgeVariant> = {
  RUNNING: "warning",
  SUCCESS: "success",
  FAILED: "error",
};

function fmt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("zh-CN");
}

function fmtKb(bytes?: number) {
  if (bytes == null) return "—";
  return `${(bytes / 1024).toFixed(1)} kB`;
}

export default function OpsPage() {
  const [logs, setLogs] = useState<AuditArchiveLog[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [endpointMissing, setEndpointMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setEndpointMissing(false);
    try {
      const r = await auditArchiveApi.list();
      setLogs(Array.isArray(r) ? r : []);
    } catch (e) {
      const err = e as ApiError;
      // 后端未实现该 endpoint：fallback EmptyState
      if (err.code === -1 || err.code === 404 || err.code >= 4000) {
        setEndpointMissing(true);
        setLogs([]);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lastArchive = useMemo(() => {
    if (!logs) return undefined;
    return logs
      .filter((l) => l.status === "SUCCESS" && l.finishedAt)
      .sort((a, b) => +new Date(b.finishedAt!) - +new Date(a.finishedAt!))[0];
  }, [logs]);

  const archiveFail7d = useMemo(() => {
    if (!logs) return 0;
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    return logs.filter(
      (l) => l.status === "FAILED" && l.finishedAt && +new Date(l.finishedAt) >= cutoff
    ).length;
  }, [logs]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">备份归档</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            RDS 快照 / 审计日志归档监控。
          </p>
        </div>
        <button
          disabled
          title="loopback only，需 SSH 节点 A 调用 POST /api/ops/backup/audit-archive/run"
          className="rounded-md border px-3 py-2 text-sm opacity-50"
        >
          立即触发归档
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Card title="上次 RDS 备份" value="—" hint="需后端补 GET /admin/ops/backup-status" />
        <Card
          title="上次审计归档"
          value={lastArchive ? fmt(lastArchive.finishedAt) : "—"}
          hint={lastArchive ? `archiveMonth=${lastArchive.archiveMonth}` : "暂无 SUCCESS 记录"}
        />
        <Card title="7 天内备份失败" value="—" hint="需后端补 GET /admin/ops/backup-status" />
        <Card
          title="7 天内归档失败"
          value={String(archiveFail7d)}
          hint={archiveFail7d > 0 ? "请检查 audit_archive_log" : "正常"}
          tone={archiveFail7d > 0 ? "error" : "neutral"}
        />
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">audit_archive_log</h2>
          <span className="text-xs text-muted-foreground">
            {logs ? `共 ${logs.length} 条` : ""}
          </span>
        </div>

        {loading && <LoadingBlock />}

        {!loading && endpointMissing && (
          <EmptyState
            title="暂无归档元数据"
            hint="需后端补 GET /admin/audit-archive 端点暴露 audit_archive_log 表"
          />
        )}

        {!loading && !endpointMissing && (logs?.length ?? 0) === 0 && (
          <EmptyState title="暂无归档记录" />
        )}

        {!loading && !endpointMissing && logs && logs.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">archiveMonth</th>
                  <th className="px-3 py-2 text-left">status</th>
                  <th className="px-3 py-2 text-left">r2Key</th>
                  <th className="px-3 py-2 text-left">sha256</th>
                  <th className="px-3 py-2 text-right">rowCount</th>
                  <th className="px-3 py-2 text-right">bytesEncrypted</th>
                  <th className="px-3 py-2 text-left">startedAt</th>
                  <th className="px-3 py-2 text-left">finishedAt</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{l.archiveMonth}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_VARIANT[l.status]}>{l.status}</Badge>
                    </td>
                    <td className="px-3 py-2 break-all font-mono text-[11px]">
                      {l.r2Key || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]" title={l.sha256 || ""}>
                      {l.sha256 ? `${l.sha256.slice(0, 10)}…` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">{l.rowCount ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtKb(l.bytesEncrypted)}</td>
                    <td className="px-3 py-2 text-xs">{fmt(l.startedAt)}</td>
                    <td className="px-3 py-2 text-xs">{fmt(l.finishedAt)}</td>
                    <td className="px-3 py-2">
                      <button
                        disabled
                        title="需后端补 GET /admin/audit-archive/{id}/download 预签名 URL"
                        className="rounded-md border px-2 py-1 text-xs opacity-50"
                      >
                        下载
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  value,
  hint,
  tone = "neutral",
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "error";
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div
        className={
          "mt-1 text-lg font-semibold " + (tone === "error" ? "text-rose-700" : "text-foreground")
        }
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
