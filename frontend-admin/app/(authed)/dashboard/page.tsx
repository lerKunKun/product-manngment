"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useAuthStore } from "@/lib/auth/store";
import { storeApi, type StoreItem } from "@/lib/api/store";
import { productApi } from "@/lib/api/product";
import { taskApi, type TaskListItem, relTime } from "@/lib/api/task";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

type Period = "today" | "week" | "month";

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "week", label: "7d" },
  { key: "month", label: "30d" },
];

/** $1,234.56 */
function fmtUsd(v: number | string | undefined | null): string {
  if (v === undefined || v === null || v === "") return "$0";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return "$0";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtInt(v: number | undefined | null): string {
  if (v === undefined || v === null) return "0";
  return v.toLocaleString("en-US");
}

function flagOf(domain: string): string {
  // 粗暴：取域名 prefix 中的 2 字母 country hint，找不到就 🌐
  const m = domain.match(/^([a-z]{2,4})[-.]/);
  const country = m?.[1]?.toUpperCase() ?? "";
  const map: Record<string, string> = {
    JP: "🇯🇵", US: "🇺🇸", DE: "🇩🇪", FR: "🇫🇷", UK: "🇬🇧", GB: "🇬🇧",
    AU: "🇦🇺", CN: "🇨🇳", KR: "🇰🇷", CA: "🇨🇦", BR: "🇧🇷", IT: "🇮🇹",
    ES: "🇪🇸", IN: "🇮🇳", MX: "🇲🇽", NL: "🇳🇱",
  };
  return map[country] ?? "🌐";
}

function statusOf(s: StoreItem): { tone: "active" | "risk" | "paused"; label: string } {
  if (s.status === "ACTIVE") {
    if (s.expiresAt) {
      const days = (new Date(s.expiresAt).getTime() - Date.now()) / 86400000;
      if (days < 7) return { tone: "risk", label: "异常" };
    }
    return { tone: "active", label: "活跃" };
  }
  if (s.status === "TOKEN_EXPIRED") return { tone: "risk", label: "异常" };
  return { tone: "paused", label: "暂停" };
}

function tokenOf(s: StoreItem): { ok: boolean; label: string } {
  if (!s.expiresAt) return { ok: true, label: "已配置" };
  const days = (new Date(s.expiresAt).getTime() - Date.now()) / 86400000;
  if (days < 0) return { ok: false, label: "已过期" };
  if (days < 30) return { ok: false, label: `${Math.floor(days)}d 到期` };
  return { ok: true, label: "已配置" };
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("month");
  const [syncing, setSyncing] = useState(false);

  const stores = useQuery({
    queryKey: ["dashboard", "stores"],
    queryFn: () => storeApi.list(),
  });

  const productsTotal = useQuery({
    queryKey: ["dashboard", "products-total"],
    queryFn: async () => (await productApi.list(1, 1)).total ?? 0,
  });

  const tasksToday = useQuery({
    queryKey: ["dashboard", "tasks-today"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoff = today.getTime();
      const r = await taskApi.list(1, 200);
      return (r.records ?? []).filter((t) => {
        if (!t.createdAt) return false;
        const ts = new Date(t.createdAt).getTime();
        return !isNaN(ts) && ts >= cutoff;
      });
    },
  });

  const recentTasks = useQuery({
    queryKey: ["dashboard", "recent-tasks"],
    queryFn: async () => (await taskApi.list(1, 8)).records ?? [],
    refetchInterval: 10_000,
  });

  const storeList: StoreItem[] = useMemo(() => stores.data ?? [], [stores.data]);

  // KPI 1：在线店铺
  const storeBreakdown = useMemo(() => {
    let active = 0, risk = 0, paused = 0;
    for (const s of storeList) {
      const t = statusOf(s).tone;
      if (t === "active") active++;
      else if (t === "risk") risk++;
      else paused++;
    }
    return { active, risk, paused, total: storeList.length };
  }, [storeList]);

  // KPI 2：产品总数（草稿/已发布无现成接口，只显示总数）
  // KPI 3：今日 GMV / 订单
  const gmvToday = useMemo(() => {
    let gmv = 0, orders = 0;
    for (const s of storeList) {
      const m = s.metricsPeriods?.today;
      if (!m) continue;
      gmv += typeof m.gmv === "string" ? parseFloat(m.gmv) || 0 : (m.gmv ?? 0);
      orders += m.orders ?? 0;
    }
    return { gmv, orders, aov: orders > 0 ? gmv / orders : 0 };
  }, [storeList]);

  // KPI 4：推送成功率
  const pushStats = useMemo(() => {
    const all = (tasksToday.data ?? []).filter((t) => t.type === "PRODUCT_PUSH");
    const finished = all.filter((t) => ["SUCCESS", "FAILED", "PARTIAL"].includes(t.status));
    const ok = finished.filter((t) => t.status === "SUCCESS").length;
    const failed = finished.filter((t) => t.status === "FAILED").length;
    const rate = finished.length > 0 ? (ok / finished.length) * 100 : 100;
    return { rate, total: all.length, failed };
  }, [tasksToday.data]);

  const tokensExpiring = useMemo(() => {
    return storeList.filter((s) => {
      if (!s.expiresAt) return false;
      const days = (new Date(s.expiresAt).getTime() - Date.now()) / 86400000;
      return days >= 0 && days < 30;
    }).length;
  }, [storeList]);

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }),
    []
  );

  async function handleSyncShopify() {
    if (syncing) return;
    setSyncing(true);
    let ok = 0, fail = 0;
    try {
      // 并发触发所有 ACTIVE 店铺的 metrics 刷新（后端单次可能 30s+，这里 fire-and-collect）
      const targets = storeList.filter((s) => s.status === "ACTIVE");
      const results = await Promise.allSettled(targets.map((s) => storeApi.refreshMetrics(s.id)));
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.result === "SUCCESS") ok++;
        else fail++;
      }
      toast.show(fail === 0 ? "success" : "warn", `同步完成：成功 ${ok} · 失败 ${fail}`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.show("error", `同步出错：${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  const isLoading = stores.isPending || productsTotal.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">工作台</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dateLabel} · {storeList.length} 个店铺 · {fmtInt(productsTotal.data)} 件产品
            {tokensExpiring > 0 && (
              <> · <span className="text-amber-600 dark:text-amber-400">{tokensExpiring} 个店铺 token 即将过期</span></>
            )}
            {user?.username && <> · 欢迎，{user.username}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSyncShopify}
          disabled={syncing || storeList.length === 0}
          className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "同步中…" : "同步 Shopify"}
        </button>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="在线店铺"
          value={isLoading ? null : fmtInt(storeBreakdown.active)}
          sub={
            isLoading
              ? null
              : `${storeBreakdown.active} ACTIVE · ${storeBreakdown.risk} RISK · ${storeBreakdown.paused} PAUSED`
          }
        />
        <KpiCard
          title="产品总数"
          value={isLoading ? null : fmtInt(productsTotal.data)}
          sub={isLoading ? null : "全部状态合计"}
        />
        <KpiCard
          title="今日 GMV"
          value={stores.isPending ? null : fmtUsd(gmvToday.gmv)}
          sub={
            stores.isPending
              ? null
              : `订单 ${fmtInt(gmvToday.orders)} · 客单 ${fmtUsd(gmvToday.aov)}`
          }
        />
        <KpiCard
          title="推送成功率"
          value={tasksToday.isPending ? null : `${pushStats.rate.toFixed(1)}%`}
          sub={
            tasksToday.isPending
              ? null
              : `今日 ${pushStats.total} 次 · 失败 ${pushStats.failed}`
          }
        />
      </div>

      {/* Stores performance table */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">店铺业绩</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {period === "today"
                ? "今日 GMV / 订单"
                : period === "week"
                ? "近 7 天 GMV / 订单"
                : "近 30 天 GMV / 订单 / Token 状态"}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5 text-xs">
            {PERIOD_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setPeriod(tab.key)}
                className={`rounded px-2.5 py-1 transition ${
                  period === tab.key
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {stores.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : storeList.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            暂无店铺。<Link href="/stores" className="text-primary hover:underline">去连接店铺 →</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">店铺</th>
                  <th className="px-4 py-2 text-right font-medium">GMV</th>
                  <th className="px-4 py-2 text-right font-medium">订单</th>
                  <th className="px-4 py-2 text-right font-medium">产品</th>
                  <th className="px-4 py-2 text-center font-medium">状态</th>
                  <th className="px-4 py-2 text-center font-medium">Token</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {storeList.map((s) => {
                  const m = s.metricsPeriods?.[period];
                  const gmv = m
                    ? typeof m.gmv === "string"
                      ? parseFloat(m.gmv) || 0
                      : m.gmv ?? 0
                    : null;
                  const orders = m?.orders ?? null;
                  const st = statusOf(s);
                  const tok = tokenOf(s);
                  return (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg leading-none">{flagOf(s.myshopifyDomain)}</span>
                          <div className="min-w-0">
                            <Link
                              href={`/stores`}
                              className="block truncate font-mono text-[13px] hover:text-primary"
                            >
                              {s.myshopifyDomain}
                            </Link>
                            <div className="text-[11px] capitalize text-muted-foreground">
                              {s.shopifyPlan ?? (s.isDevStore ? "Dev" : "—")}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {gmv === null ? <span className="text-muted-foreground">—</span> : fmtUsd(gmv)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {orders === null ? <span className="text-muted-foreground">—</span> : fmtInt(orders)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtInt(s.productCount)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <StatusPill tone={st.tone} label={st.label} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                            tok.ok
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                          }`}
                        >
                          {tok.ok ? "✓" : "⚠"} {tok.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Recent tasks */}
      <Card>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">实时任务</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">最近 8 条 · 每 10s 自动刷新</p>
          </div>
          <Link
            href="/tasks"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            查看全部 →
          </Link>
        </div>
        {recentTasks.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (recentTasks.data ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">暂无任务</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">类型</th>
                  <th className="px-4 py-2 text-left font-medium">店铺</th>
                  <th className="px-4 py-2 text-left font-medium">进度</th>
                  <th className="px-4 py-2 text-center font-medium">状态</th>
                  <th className="px-4 py-2 text-right font-medium">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(recentTasks.data ?? []).map((task) => (
                  <TaskRow key={task.id} task={task} stores={storeList} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: string | null;
  sub: string | null;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">
        {value === null ? <Skeleton className="h-9 w-24" /> : value}
      </div>
      {sub === null ? (
        <Skeleton className="mt-2 h-3 w-32" />
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">{sub}</div>
      )}
    </Card>
  );
}

function StatusPill({ tone, label }: { tone: "active" | "risk" | "paused"; label: string }) {
  const cls =
    tone === "active"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
      : tone === "risk"
      ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"
      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/10 dark:text-zinc-400";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${cls}`}>
      {label}
    </span>
  );
}

function TaskRow({ task, stores }: { task: TaskListItem; stores: StoreItem[] }) {
  const store = stores.find((s) => s.id === task.storeId);
  const pct =
    task.status === "SUCCESS"
      ? 100
      : task.status === "FAILED" || task.status === "PARTIAL"
      ? 60
      : task.status === "RUNNING"
      ? 50
      : task.status === "PENDING"
      ? 10
      : 0;
  const barColor =
    task.status === "SUCCESS"
      ? "bg-emerald-500"
      : task.status === "FAILED"
      ? "bg-rose-500"
      : task.status === "PARTIAL"
      ? "bg-amber-500"
      : task.status === "RUNNING"
      ? "bg-sky-500"
      : "bg-zinc-300";
  const statusCls =
    task.status === "SUCCESS"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
      : task.status === "FAILED"
      ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"
      : task.status === "PARTIAL"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
      : task.status === "RUNNING"
      ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400"
      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/10 dark:text-zinc-400";
  const statusLabel: Record<string, string> = {
    PENDING: "等待",
    RUNNING: "运行中",
    SUCCESS: "成功",
    FAILED: "失败",
    PARTIAL: "部分成功",
    CANCELED: "已取消",
  };
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2.5">
        <Link href={`/tasks/${task.id}`} className="font-mono text-xs hover:text-primary">
          #{task.id} {task.type}
        </Link>
        {task.errorMessage && (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground" style={{ maxWidth: 280 }}>
            {task.errorMessage}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 font-mono text-[13px] text-muted-foreground">
        {store ? store.myshopifyDomain.split(".")[0] : task.storeId ?? "—"}
      </td>
      <td className="px-4 py-2.5">
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </td>
      <td className="px-4 py-2.5 text-center">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${statusCls}`}>
          {statusLabel[task.status] ?? task.status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
        {relTime(task.createdAt)}
      </td>
    </tr>
  );
}
