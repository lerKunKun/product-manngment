"use client";

// TODO i18n: 卡片版重写后中文 hardcoded；后续抽到 messages.ts
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  storeApi,
  type StoreItem,
  type MetricsPeriod,
  METRICS_PERIOD_LABEL,
} from "@/lib/api/store";
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

/** token 剩余天数：null=无过期时间（OAuth offline / custom_app 永久）；负数=已过期 */
function tokenDaysLeft(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

/** OAuth offline scope 和 custom_app token 都不带 expiresAt，但确实"已配置"——
 *  不能直接显示"未配置 token"误导用户。仅当 tokenType 也缺失才算真未配置。 */
function tokenBadgeClass(days: number | null, tokenType?: StoreItem["tokenType"]): string {
  if (days == null) {
    if (!tokenType) return "bg-muted/40 text-muted-foreground border";
    return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400";
  }
  if (days < 0) return "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-500/15 dark:text-rose-400";
  if (days < 30) return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-400";
  return "bg-muted/40 text-muted-foreground border";
}
function tokenBadgeText(days: number | null, tokenType?: StoreItem["tokenType"]): string {
  if (days == null) {
    if (tokenType === "oauth") return "OAuth 已授权";
    if (tokenType === "custom_app") return "永久 token";
    if (tokenType === "cli") return "CLI token";
    return "未配置 token";
  }
  if (days < 0) return "token 已过期";
  return `${days} 天 token`;
}

function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

/** 跳到 Shopify Admin 后台。biou-jp.myshopify.com → admin.shopify.com/store/biou-jp */
function shopifyAdminUrl(domain: string): string {
  const prefix = domain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${prefix}`;
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
  const searchParams = useSearchParams();
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

  /** OAuth 回调落地：后端 ShopifyOAuthController 302 到 /stores?connected=xxx 或 ?error=xxx，
   *  在这里读 query → 弹 3s toast → invalidate 列表 → 清 URL，避免空白无反馈。 */
  useEffect(() => {
    const connected = searchParams.get("connected");
    const oauthError = searchParams.get("error");
    if (!connected && !oauthError) return;
    if (connected) {
      toast.success(`店铺 ${connected} 授权成功`, 3000);
      invalidate();
    } else if (oauthError) {
      toast.error(`授权失败：${oauthError}`, 5000);
    }
    router.replace("/stores");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /** 5 个时间窗 tab 当前选中（产品级一次切换不影响数据，只切显示） */
  const [period, setPeriod] = useState<MetricsPeriod>("month");
  /** mount 自动批量刷新一次（避免每次切回页面都刷）；用 ref 防 strict mode 双触发 */
  const autoRefreshedRef = useRef(false);

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

  /** 进页面 mount 自动批量刷新（并发 3，避免一起打 Shopify 速率限制）。 */
  useEffect(() => {
    if (autoRefreshedRef.current) return;
    if (isPending || stores.length === 0) return;
    autoRefreshedRef.current = true;

    const ids = stores.map((s) => s.id);
    const CONCURRENT = 3;
    let cursor = 0;

    setRefreshing((m) => {
      const next = { ...m };
      ids.forEach((id) => (next[id] = true));
      return next;
    });

    async function worker() {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          await storeApi.refreshMetrics(id);
        } catch {
          /* 单店失败不阻断其他 */
        } finally {
          setRefreshing((m) => ({ ...m, [id]: false }));
        }
      }
    }

    Promise.all(Array.from({ length: CONCURRENT }, worker)).then(() => {
      invalidate();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, stores.length]);

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

      {/* 时间窗切换：影响所有卡片的 GMV / 订单数显示（产品数与时间无关，不变） */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/20 p-1 text-xs">
        {(["today", "week", "month", "year", "ytd"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={
              "rounded px-3 py-1.5 transition-colors " +
              (period === p
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {METRICS_PERIOD_LABEL[p]}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          数据来自 Shopify orders.json · 进页面自动刷新一次
        </span>
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

                {/* 三列指标 — GMV / 订单按当前 period；产品数与时间无关 */}
                {(() => {
                  const bucket = s.metricsPeriods?.[period];
                  const ccy = s.metricsPeriods?.currency ?? s.metricsCurrency ?? null;
                  const fetchedAtTitle = s.metricsFetchedAt
                    ? `${METRICS_PERIOD_LABEL[period]} paid 订单 GMV\n刷新于：${new Date(s.metricsFetchedAt).toLocaleString("zh-CN")}`
                    : "尚未刷新或 token 缺失；点右下 ↻ 重试";
                  return (
                    <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-[11px] text-muted-foreground">
                          GMV · {METRICS_PERIOD_LABEL[period]}
                        </div>
                        <div className="mt-0.5 font-semibold tabular-nums" title={fetchedAtTitle}>
                          {fmtGmv(bucket?.gmv, ccy)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">
                          订单 · {METRICS_PERIOD_LABEL[period]}
                        </div>
                        <div className="mt-0.5 font-semibold tabular-nums" title={fetchedAtTitle}>
                          {fmtNumber(bucket?.orders ?? null)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">产品</div>
                        <div className="mt-0.5 font-semibold tabular-nums">
                          {fmtNumber(s.productCount ?? 0)}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 底部：token 天数 + 操作 */}
                <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                  <span
                    className={
                      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] " +
                      tokenBadgeClass(days, s.tokenType)
                    }
                  >
                    <span aria-hidden>⏱</span>
                    {tokenBadgeText(days, s.tokenType)}
                  </span>
                  <div className="flex items-center gap-1">
                    {/* 独立刷新按钮 */}
                    <button
                      type="button"
                      title="刷新指标（plan / GMV / 订单数）"
                      disabled={!!refreshing[s.id]}
                      onClick={() => onRefreshMetrics(s)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
                      aria-label="刷新指标"
                    >
                      <span className={refreshing[s.id] ? "inline-block animate-spin" : ""}>↻</span>
                    </button>
                    {/* 跳 Shopify Admin 后台 */}
                    <a
                      href={shopifyAdminUrl(s.myshopifyDomain)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`在 Shopify Admin 打开 ${s.myshopifyDomain}`}
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                      aria-label="打开 Shopify Admin"
                    >
                      ↗
                    </a>
                    {/* 健康检查 */}
                    <button
                      type="button"
                      title="健康检查（验证 token）"
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
                        平台内详情
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
