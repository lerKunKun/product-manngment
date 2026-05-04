"use client";

// TODO i18n: 卡片版重写后中文 hardcoded；后续抽到 messages.ts
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { storeApi, type StoreItem } from "@/lib/api/store";
import { useStores, useInvalidateStores } from "@/lib/queries/stores";
import { useToast } from "@/components/ui/Toast";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";

/** 域名 → 国旗 emoji。覆盖 biou-XX.myshopify.com 命名约定 + 兜底 🌐 */
const COUNTRY_FLAG: Record<string, string> = {
  cn: "🇨🇳", us: "🇺🇸", jp: "🇯🇵", de: "🇩🇪", fr: "🇫🇷",
  uk: "🇬🇧", gb: "🇬🇧", au: "🇦🇺", ca: "🇨🇦", in: "🇮🇳",
  br: "🇧🇷", mx: "🇲🇽", es: "🇪🇸", it: "🇮🇹", kr: "🇰🇷",
  sg: "🇸🇬", hk: "🇭🇰", tw: "🇹🇼", nl: "🇳🇱", ru: "🇷🇺",
};
function flagFor(domain: string): string {
  const m = domain.match(/^[^.]*?-([a-z]{2})\b/i) ?? domain.match(/^([a-z]{2})\./i);
  if (m) {
    const code = m[1].toLowerCase();
    if (COUNTRY_FLAG[code]) return COUNTRY_FLAG[code];
  }
  return "🌐";
}

/** 状态显示映射：DISABLED 在 UI 上显示 PAUSED */
const STATUS_INFO: Record<
  StoreItem["status"],
  { label: string; cls: string }
> = {
  ACTIVE: {
    label: "ACTIVE",
    cls: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  DISABLED: {
    label: "PAUSED",
    cls: "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-500/15 dark:text-zinc-400",
  },
  TOKEN_EXPIRED: {
    label: "TOKEN EXPIRED",
    cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-400",
  },
  UNINSTALLED: {
    label: "UNINSTALLED",
    cls: "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-500/15 dark:text-rose-400",
  },
};

/** plan 推断：优先用后端 shopifyPlan（plan_name），回退按 isDevStore / Partner 标记。
 *  Shopify 常见 plan_name：affiliate / partner_test / shopify_alumni / basic / professional /
 *  unlimited / shopify_plus / enterprise / dev / staff_business / etc. */
function planLabel(s: StoreItem): string {
  const raw = (s.shopifyPlan ?? "").toLowerCase();
  if (raw.includes("plus")) return "Shopify Plus";
  if (raw.includes("enterprise")) return "Shopify Plus";
  if (raw.includes("partner_test") || raw === "dev") return "Dev";
  if (raw.includes("staff_business")) return "Staff";
  if (raw.includes("affiliate")) return "Affiliate";
  if (raw && !raw.includes("partner")) return "Shopify";
  if (s.isDevStore) return "Dev";
  if (s.isPartnerCollab) return "Partner Dev";
  return "Shopify";
}

/** token 剩余天数：null=未配置；负数=已过期 */
function tokenDaysLeft(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

function tokenBadgeClass(days: number | null): string {
  if (days == null) return "bg-muted/40 text-muted-foreground border";
  if (days < 0) return "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-500/15 dark:text-rose-400";
  if (days < 30) return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-400";
  return "bg-muted/40 text-muted-foreground border";
}
function tokenBadgeText(days: number | null): string {
  if (days == null) return "未配置 token";
  if (days < 0) return "token 已过期";
  return `${days} 天 token`;
}

function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

const CCY_SYMBOL: Record<string, string> = {
  USD: "$", CNY: "¥", EUR: "€", GBP: "£", JPY: "¥",
  AUD: "A$", CAD: "C$", HKD: "HK$", SGD: "S$",
};
/** 按本币显示 GMV：≥10k 折成「N.N 万」（CNY/JPY 习惯），否则带 2 位小数 */
function fmtGmv(raw: number | string | null | undefined, currency?: string | null): string {
  if (raw == null || raw === "") return "—";
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(n)) return "—";
  const sym = CCY_SYMBOL[(currency ?? "USD").toUpperCase()] ?? `${currency ?? ""} `;
  const useWan = (currency ?? "USD").toUpperCase() === "CNY" || (currency ?? "").toUpperCase() === "JPY";
  if (useWan && n >= 10000) return `${sym}${(n / 10000).toFixed(1)} 万`;
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)} M`;
  if (n >= 10_000) return `${sym}${(n / 1_000).toFixed(1)} K`;
  return `${sym}${n.toFixed(2)}`;
}

const SENSITIVE_DELETE = "STORE_DELETE";
const SENSITIVE_DISABLE = "STORE_BATCH_DISABLE";
const SENSITIVE_PARTNER = "STORE_MARK_PARTNER_COLLAB";

export default function StoresPage() {
  const toast = useToast();
  const router = useRouter();
  const { data, isPending, error } = useStores();
  const invalidate = useInvalidateStores();
  const stores: StoreItem[] = data ?? [];
  const errorMsg = error ? (error as Error).message : "";

  const summary = useMemo(() => {
    const total = stores.length;
    const active = stores.filter((s) => s.status === "ACTIVE").length;
    const paused = stores.filter((s) => s.status === "DISABLED").length;
    const expired = stores.filter((s) => s.status === "TOKEN_EXPIRED").length;
    const uninstalled = stores.filter((s) => s.status === "UNINSTALLED").length;
    return { total, active, paused, expired, uninstalled };
  }, [stores]);

  const [healthChecking, setHealthChecking] = useState<Record<number, boolean>>({});
  const [refreshing, setRefreshing] = useState<Record<number, boolean>>({});

  async function onRefreshMetrics(s: StoreItem) {
    setRefreshing((m) => ({ ...m, [s.id]: true }));
    try {
      const r = await storeApi.refreshMetrics(s.id);
      if (r.result === "SUCCESS") toast.success(`#${s.id} 指标已刷新`);
      else if (r.result === "SKIPPED") toast.warn(`#${s.id} 已跳过（token 缺失）`);
      else toast.error(`#${s.id} 刷新失败`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing((m) => ({ ...m, [s.id]: false }));
    }
  }

  async function onHealthCheck(id: number) {
    setHealthChecking((m) => ({ ...m, [id]: true }));
    try {
      const r = await storeApi.healthCheck(id);
      if (r.ok) toast.success(`#${id} 健康`);
      else toast.error(`#${id} 检测失败：${r.message ?? "未知"}`);
      invalidate();
    } finally {
      setHealthChecking((m) => ({ ...m, [id]: false }));
    }
  }

  /** 通用敏感操作：发码 → prompt → verify → 拿 token 给 callback。 */
  async function withSensitive(action: string, fn: (token: string) => Promise<void>) {
    try {
      await storeApi.requestSensitiveCode(action);
      const code = window.prompt("钉钉验证码（已发送至工作通知）");
      if (!code) {
        toast.info("已取消");
        return;
      }
      const { sensitiveToken } = await storeApi.verifySensitive(action, code);
      await fn(sensitiveToken);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onDelete(s: StoreItem) {
    if (!window.confirm(`删除店铺 ${s.myshopifyDomain}？此操作不可恢复。`)) return;
    await withSensitive(SENSITIVE_DELETE, async (token) => {
      await storeApi.delete(s.id, token);
      toast.success("已删除");
    });
  }

  async function onDisable(s: StoreItem) {
    if (!window.confirm(`暂停店铺 ${s.myshopifyDomain}？`)) return;
    await withSensitive(SENSITIVE_DISABLE, async (token) => {
      await storeApi.disable(s.id, token);
      toast.success("已暂停");
    });
  }

  async function onTogglePartnerCollab(s: StoreItem) {
    const target = !s.isPartnerCollab;
    await withSensitive(SENSITIVE_PARTNER, async (token) => {
      if (target) await storeApi.markPartnerCollab(s.id, token);
      else await storeApi.unmarkPartnerCollab(s.id, token);
      toast.success(target ? "已标记为合作店" : "已取消合作店标记");
    });
  }

  return (
    <div className="space-y-6">
      {/* 标题 + 摘要 + 接入新店铺 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">店铺管理</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.total} 个店铺
            {summary.active > 0 && <> · <span className="text-emerald-700 dark:text-emerald-400">{summary.active} 个 ACTIVE</span></>}
            {summary.paused > 0 && <> · <span className="text-zinc-600 dark:text-zinc-400">{summary.paused} 个 PAUSED</span></>}
            {summary.expired > 0 && <> · <span className="text-amber-700 dark:text-amber-400">{summary.expired} 个 TOKEN EXPIRED</span></>}
            {summary.uninstalled > 0 && <> · <span className="text-rose-700 dark:text-rose-400">{summary.uninstalled} 个 UNINSTALLED</span></>}
          </p>
        </div>
        <Link
          href="/stores/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          + 接入新店铺
        </Link>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {isPending && (
        <div className="rounded-lg border bg-background p-12 text-center text-sm text-muted-foreground">
          加载中...
        </div>
      )}

      {!isPending && stores.length === 0 && (
        <div className="rounded-lg border bg-background p-12 text-center">
          <p className="text-sm text-muted-foreground">暂无店铺</p>
          <Link
            href="/stores/new"
            className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            接入第一个店铺
          </Link>
        </div>
      )}

      {/* 卡片网格 */}
      {!isPending && stores.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {stores.map((s) => {
            const days = tokenDaysLeft(s.expiresAt);
            const status = STATUS_INFO[s.status] ?? STATUS_INFO.DISABLED;
            return (
              <article
                key={s.id}
                className="flex flex-col rounded-lg border bg-background p-4 transition-shadow hover:shadow-sm"
              >
                {/* 顶部：国旗 + 域名 + 状态 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="text-2xl leading-none" aria-hidden>
                      {flagFor(s.myshopifyDomain)}
                    </span>
                    <div className="min-w-0">
                      <div
                        className="truncate font-mono text-sm font-medium"
                        title={s.myshopifyDomain}
                      >
                        {s.myshopifyDomain}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {planLabel(s)}
                      </div>
                    </div>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide " +
                      status.cls
                    }
                  >
                    {status.label}
                  </span>
                </div>

                {/* 三列指标 */}
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[11px] text-muted-foreground">GMV</div>
                    <div
                      className="mt-0.5 font-semibold tabular-nums"
                      title={
                        s.metricsFetchedAt
                          ? `近 30 天 paid 订单 GMV\n刷新于：${new Date(s.metricsFetchedAt).toLocaleString("zh-CN")}`
                          : "尚未刷新；点右下角 ⚙ → 刷新指标"
                      }
                    >
                      {fmtGmv(s.gmv, s.metricsCurrency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">订单</div>
                    <div
                      className="mt-0.5 font-semibold tabular-nums"
                      title="订单数据待 W3 接 Shopify orders.json 后填充"
                    >
                      {fmtNumber(s.orderCount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">产品</div>
                    <div className="mt-0.5 font-semibold tabular-nums">
                      {fmtNumber(s.productCount ?? 0)}
                    </div>
                  </div>
                </div>

                {/* 底部：token 天数 + 操作 */}
                <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                  <span
                    className={
                      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] " +
                      tokenBadgeClass(days)
                    }
                  >
                    <span aria-hidden>⏱</span>
                    {tokenBadgeText(days)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="健康检查"
                      disabled={!!healthChecking[s.id]}
                      onClick={() => onHealthCheck(s.id)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
                      aria-label="健康检查"
                    >
                      {healthChecking[s.id] ? "⌛" : "👁"}
                    </button>
                    <DropdownMenu
                      align="right"
                      trigger={
                        <button
                          type="button"
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                          aria-label="更多操作"
                          title="更多操作"
                        >
                          ⚙
                        </button>
                      }
                    >
                      <DropdownItem onClick={() => router.push(`/stores/${s.id}`)}>
                        查看详情
                      </DropdownItem>
                      <DropdownItem
                        disabled={!!refreshing[s.id]}
                        onClick={() => onRefreshMetrics(s)}
                      >
                        {refreshing[s.id] ? "刷新中..." : "刷新指标（plan / GMV）"}
                      </DropdownItem>
                      <DropdownItem onClick={() => onTogglePartnerCollab(s)}>
                        {s.isPartnerCollab ? "取消合作店标记" : "标记为合作店"}
                      </DropdownItem>
                      {s.status === "ACTIVE" && (
                        <DropdownItem onClick={() => onDisable(s)}>
                          暂停店铺
                        </DropdownItem>
                      )}
                      <DropdownItem variant="destructive" onClick={() => onDelete(s)}>
                        删除店铺
                      </DropdownItem>
                    </DropdownMenu>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
