"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, EmptyState, ErrorBanner } from "@/components/ui/StatusBlocks";
import {
  crossAuthApi,
  STATUS_BADGE,
  type CrossAuthGrant,
} from "@/lib/api/crossAuth";
import { CrossAuthGrantDialog } from "@/components/crossAuth/CrossAuthGrantDialog";
import type { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";

const SENSITIVE_ACTION = "CROSS_AUTH_REVOKE";
const SENSITIVE_ACTION_RENEW = "CROSS_AUTH_RENEW";

const ONE_DAY_MS = 24 * 3600 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

const STATUS_FILTERS = [
  { v: "", label: "全部" },
  { v: "ACTIVE", label: "生效" },
  { v: "REVOKED", label: "已撤销" },
  { v: "EXPIRED", label: "已过期" },
];

export default function CrossAuthPage() {
  const toast = useToast();
  const { t } = useI18n();
  const [list, setList] = useState<CrossAuthGrant[]>([]);
  const [status, setStatus] = useState<string>("ACTIVE");
  const [userIdFilter, setUserIdFilter] = useState<string>("");
  const [granterCompanyIdFilter, setGranterCompanyIdFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await crossAuthApi.list({
        status: status || undefined,
        userId: userIdFilter ? Number(userIdFilter) : undefined,
        granterCompanyId: granterCompanyIdFilter ? Number(granterCompanyIdFilter) : undefined,
      });
      setList(data ?? []);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function revoke(id: number) {
    if (!confirm(`撤销跨公司授权 #${id}？需要钉钉验证码二次确认。`)) return;
    try {
      await crossAuthApi.requestSensitiveCode(SENSITIVE_ACTION);
      const code = window.prompt(
        "钉钉收到的 6 位验证码（钉钉未配 dingtalk_userid 时看 backend 日志）："
      );
      if (!code) {
        toast.info("已取消");
        return;
      }
      const { sensitiveToken } = await crossAuthApi.verifySensitive(SENSITIVE_ACTION, code);
      await crossAuthApi.revoke(id, sensitiveToken);
      toast.success(t("crossAuth.revoked").replace("{id}", String(id)));
      load();
    } catch {
      /* 全局 toast 已上报 */
    }
  }

  function isExpiringSoon(g: CrossAuthGrant) {
    if (g.status !== "ACTIVE") return false;
    const ms = new Date(g.expiresAt).getTime() - Date.now();
    return ms > 0 && ms < ONE_DAY_MS;
  }

  async function renew(g: CrossAuthGrant) {
    if (
      !confirm(
        `续期跨公司授权 #${g.id}？将创建一条新授权（有效期 7 天，旧记录保留至自然过期）。需要钉钉验证码二次确认。`
      )
    )
      return;
    try {
      await crossAuthApi.requestSensitiveCode(SENSITIVE_ACTION_RENEW);
      const code = window.prompt(
        "钉钉收到的 6 位验证码（钉钉未配 dingtalk_userid 时看 backend 日志）："
      );
      if (!code) {
        toast.info("已取消");
        return;
      }
      const { sensitiveToken } = await crossAuthApi.verifySensitive(
        SENSITIVE_ACTION_RENEW,
        code
      );
      const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();
      await crossAuthApi.grant(
        {
          userId: g.userId,
          scopeType: g.scopeType,
          scopeId: g.scopeId,
          expiresAt,
          grantedBy: g.grantedBy,
          granterCompanyId: g.granterCompanyId,
        },
        sensitiveToken
      );
      toast.success(t("crossAuth.renewed"));
      load();
    } catch {
      /* 全局 toast 已上报 */
    }
  }

  const expiringSoon = list.filter(isExpiringSoon);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("crossAuth.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("crossAuth.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled
            title="v1.1 支持"
            className="cursor-not-allowed rounded-md border px-4 py-2 text-sm font-medium opacity-50"
          >
            {t("crossAuth.batchCreate")}
          </button>
          <button
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("crossAuth.create")}
          </button>
        </div>
      </div>

      {expiringSoon.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-1.5 font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            {t("crossAuth.expiringSoonTitle").replace("{{count}}", String(expiringSoon.length))}
          </div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {expiringSoon.map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                <span className="font-mono text-xs">#{g.id}</span>
                <span className="text-xs">
                  受让人 userId={g.userId} · {g.scopeType}#{g.scopeId}
                </span>
                <span className="text-xs">
                  到期 {new Date(g.expiresAt).toLocaleString("zh-CN")}
                </span>
                <button
                  onClick={() => renew(g)}
                  className="ml-auto rounded border border-amber-400 bg-white px-2 py-0.5 text-xs hover:bg-amber-100"
                >
                  {t("crossAuth.renew7d")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-background p-3">
        <div className="flex gap-1 text-sm">
          {STATUS_FILTERS.map((opt) => (
            <button
              key={opt.v}
              onClick={() => setStatus(opt.v)}
              className={
                "rounded-md border px-3 py-1.5 transition-colors " +
                (status === opt.v ? "border-primary bg-primary text-primary-foreground" : "")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">受让人 userId</label>
            <input
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              inputMode="numeric"
              placeholder="可选"
              className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">授权方公司 ID</label>
            <input
              value={granterCompanyIdFilter}
              onChange={(e) => setGranterCompanyIdFilter(e.target.value)}
              inputMode="numeric"
              placeholder="可选"
              className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={load}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            查询
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{t("crossAuth.column.id")}</th>
              <th className="px-3 py-2 text-left">{t("crossAuth.column.userId")}</th>
              <th className="px-3 py-2 text-left">{t("crossAuth.column.scope")}</th>
              <th className="px-3 py-2 text-left">{t("crossAuth.column.source")}</th>
              <th className="px-3 py-2 text-left">{t("crossAuth.column.expiresAt")}</th>
              <th className="px-3 py-2 text-left">{t("crossAuth.column.status")}</th>
              <th className="px-3 py-2 text-left">{t("crossAuth.column.notified")}</th>
              <th className="px-3 py-2 text-left">{t("crossAuth.column.createdAt")}</th>
              <th className="px-3 py-2 text-right">{t("crossAuth.column.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9}>
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-2">
                  <EmptyState
                    title="暂无跨公司授权记录"
                    hint="点击右上角“+ 新建跨公司授权”创建第一条"
                  />
                </td>
              </tr>
            )}
            {!loading &&
              list.map((g) => {
                const badge = STATUS_BADGE[g.status] ?? STATUS_BADGE.REVOKED;
                const expiringSoon = isExpiringSoon(g);
                return (
                  <tr key={g.id} className="border-t">
                    <td className="px-3 py-2">{g.id}</td>
                    <td className="px-3 py-2 font-mono text-xs">{g.userId}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className="font-mono">
                        {g.scopeType}#{g.scopeId}
                      </span>
                      {g.crossCompany && (
                        <span className="ml-1 inline-block rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-900">
                          跨公司
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{g.source}</td>
                    <td className="px-3 py-2 text-xs">
                      {new Date(g.expiresAt).toLocaleString("zh-CN")}
                      {expiringSoon && (
                        <span className="ml-1 inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900">
                          即将过期
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={"inline-block rounded border px-2 py-0.5 text-xs " + badge.cls}>
                        {badge.text}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {g.expiringNotifiedAt
                        ? new Date(g.expiringNotifiedAt).toLocaleString("zh-CN")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(g.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {g.status === "ACTIVE" && (
                        <>
                          <button
                            onClick={() => renew(g)}
                            className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                          >
                            {t("crossAuth.renew")}
                          </button>
                          <button
                            onClick={() => revoke(g.id)}
                            className="rounded border px-2 py-1 text-xs hover:bg-accent"
                          >
                            {t("crossAuth.revoke")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <CrossAuthGrantDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={load}
      />
    </div>
  );
}
