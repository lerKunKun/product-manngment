"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock, EmptyState, ErrorBanner } from "@/components/ui/StatusBlocks";
import { toast } from "@/components/ui/Toast";
import {
  auditArchiveApi,
  type AuditArchiveLog,
  type BackupStatus,
} from "@/lib/api/auditArchive";
import { ApiError } from "@/lib/api/client";

const STATUS_VARIANT: Record<AuditArchiveLog["status"], BadgeVariant> = {
  RUNNING: "warning",
  SUCCESS: "success",
  FAILED: "error",
};

const SENSITIVE_ACTION = "AUDIT_ARCHIVE_RUN";

function fmt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("zh-CN");
}

function fmtKb(bytes?: number) {
  if (bytes == null) return "—";
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/** unix s → "X 小时前" / "X 分钟前" / "—" */
function formatRelative(unixSeconds?: number) {
  if (!unixSeconds) return "—";
  const diffMs = Date.now() - unixSeconds * 1000;
  if (diffMs < 0) return "—";
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

/** 默认上月，YYYY-MM */
function defaultMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export default function OpsPage() {
  const [logs, setLogs] = useState<AuditArchiveLog[] | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [runOpen, setRunOpen] = useState(false);
  const [runMonth, setRunMonth] = useState(defaultMonth());
  const [runCode, setRunCode] = useState("");
  const [runStep, setRunStep] = useState<"input" | "verify">("input");
  const [runSubmitting, setRunSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, st] = await Promise.all([
        auditArchiveApi.list(),
        auditArchiveApi.backupStatus(),
      ]);
      setLogs(Array.isArray(list) ? list : []);
      setStatus(st);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDownload(id: number) {
    try {
      const r = await auditArchiveApi.download(id);
      window.open(r.url, "_blank");
      toast.success("下载链接 15 分钟内有效");
    } catch {
      /* 全局 toast 已上报 */
    }
  }

  function openRun() {
    setRunMonth(defaultMonth());
    setRunCode("");
    setRunStep("input");
    setRunOpen(true);
  }

  async function requestCode() {
    if (!/^\d{4}-\d{2}$/.test(runMonth)) {
      toast.error("月份格式应为 YYYY-MM");
      return;
    }
    setRunSubmitting(true);
    try {
      await auditArchiveApi.requestSensitiveCode(SENSITIVE_ACTION);
      toast.info("钉钉验证码已下发，请输入");
      setRunStep("verify");
    } catch {
      /* toast handled */
    } finally {
      setRunSubmitting(false);
    }
  }

  async function confirmRun() {
    if (!/^\d{6}$/.test(runCode)) {
      toast.error("请输入 6 位验证码");
      return;
    }
    setRunSubmitting(true);
    try {
      const { sensitiveToken } = await auditArchiveApi.verifySensitive(
        SENSITIVE_ACTION,
        runCode
      );
      await auditArchiveApi.runArchive(runMonth, sensitiveToken);
      toast.success(`已触发 ${runMonth} 归档`);
      setRunOpen(false);
      load();
    } catch {
      /* toast handled */
    } finally {
      setRunSubmitting(false);
    }
  }

  const lastArchive = useMemo(() => {
    if (!logs) return undefined;
    return logs
      .filter((l) => l.status === "SUCCESS" && l.finishedAt)
      .sort((a, b) => +new Date(b.finishedAt!) - +new Date(a.finishedAt!))[0];
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
          type="button"
          onClick={openRun}
          className="rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted"
        >
          立即触发归档
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>上次 RDS 备份</CardDescription>
            <CardTitle>{formatRelative(status?.backupLastSuccessSeconds)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>上次审计归档</CardDescription>
            <CardTitle>
              {formatRelative(status?.archiveLastSuccessSeconds)}
            </CardTitle>
            {lastArchive && (
              <div className="text-[11px] text-muted-foreground">
                archiveMonth={lastArchive.archiveMonth}
              </div>
            )}
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>7 天内备份失败</CardDescription>
            <CardTitle
              className={
                (status?.backupFailedCount7d ?? 0) > 0 ? "text-rose-700" : undefined
              }
            >
              {status?.backupFailedCount7d ?? "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>7 天内归档失败</CardDescription>
            <CardTitle
              className={
                (status?.archiveFailedCount7d ?? 0) > 0 ? "text-rose-700" : undefined
              }
            >
              {status?.archiveFailedCount7d ?? "—"}
            </CardTitle>
            <div className="text-[11px] text-muted-foreground">
              {(status?.archiveFailedCount7d ?? 0) > 0
                ? "请检查 audit_archive_log"
                : "正常"}
            </div>
          </CardHeader>
        </Card>
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

        {!loading && (logs?.length ?? 0) === 0 && (
          <EmptyState title="暂无归档记录" />
        )}

        {!loading && logs && logs.length > 0 && (
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
                        type="button"
                        disabled={l.status !== "SUCCESS"}
                        onClick={() => handleDownload(l.id)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
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

      <Dialog
        open={runOpen}
        onClose={() => !runSubmitting && setRunOpen(false)}
        title="立即触发审计归档"
        footer={
          runStep === "input" ? (
            <>
              <button
                type="button"
                onClick={() => setRunOpen(false)}
                disabled={runSubmitting}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={requestCode}
                disabled={runSubmitting}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                获取验证码
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setRunStep("input")}
                disabled={runSubmitting}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                上一步
              </button>
              <button
                type="button"
                onClick={confirmRun}
                disabled={runSubmitting}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                确认触发
              </button>
            </>
          )
        }
      >
        {runStep === "input" && (
          <div className="space-y-2">
            <label className="block text-xs font-medium">归档月（YYYY-MM）</label>
            <input
              type="month"
              value={runMonth}
              onChange={(e) => setRunMonth(e.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              将归档 sys_audit_log 中该月的所有记录到 R2，并删除原表数据。
            </p>
          </div>
        )}
        {runStep === "verify" && (
          <div className="space-y-2">
            <p className="text-xs">
              已对 <span className="font-mono">AUDIT_ARCHIVE_RUN</span> 下发钉钉验证码，请输入 6 位数字。
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={runCode}
              onChange={(e) => setRunCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6 位验证码"
              className="w-full rounded-md border px-2 py-1.5 text-sm font-mono tracking-widest"
            />
            <p className="text-[11px] text-muted-foreground">
              将归档月份：<span className="font-mono">{runMonth}</span>
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
