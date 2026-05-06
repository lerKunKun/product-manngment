"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, ErrorBanner } from "@/components/ui/StatusBlocks";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { purchaseApi, type PurchaseInfo, type SkuChangeLog } from "@/lib/api/purchase";
import { utilApi, type UsdCnyRate } from "@/lib/api/util";
import { SkuChangeDialog } from "./SkuChangeDialog";
import type { ApiError } from "@/lib/api/client";

const inpSm =
  "rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type Currency = "USD" | "CNY";

/** 批量编辑字段：成本 / 克重 / 物流标签（前两个数值，后一个文本） */
type BatchField = "cost" | "grossWeight" | "logisticsTags";

const BATCH_LABEL: Record<BatchField, string> = {
  cost: "成本",
  grossWeight: "克重 (g)",
  logisticsTags: "物流标签",
};

type Draft = {
  cost: string;
  grossWeight: string;
  logisticsTags: string;
  purchaseUrl: string;
  note: string;
};

function toDraft(r: PurchaseInfo): Draft {
  return {
    cost: r.cost == null ? "" : String(r.cost),
    grossWeight: r.grossWeight == null ? "" : String(r.grossWeight),
    logisticsTags: r.logisticsTags ?? "",
    purchaseUrl: r.purchaseUrl ?? "",
    note: r.note ?? "",
  };
}

const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", CNY: "¥" };

/** 取多数 currency 作为整产品币种；空集 / 无数据走 CNY 默认（与 V6 schema 默认值一致）。*/
function majorityCurrency(rows: PurchaseInfo[]): Currency {
  let usd = 0, cny = 0;
  for (const r of rows) {
    if (r.currency === "USD") usd++;
    else cny++; // null / 其他都按 CNY 处理（兼容历史脏数据）
  }
  return usd > cny ? "USD" : "CNY";
}

const SYNC_BADGE: Record<string, { v: BadgeVariant; label: string }> = {
  PENDING: { v: "warning", label: "PENDING" },
  SUCCESS: { v: "success", label: "SUCCESS" },
  PARTIAL: { v: "warning", label: "PARTIAL" },
  FAILED: { v: "error", label: "FAILED" },
};

export function PurchaseTab({ productId }: { productId: number }) {
  const toast = useToast();
  const [rows, setRows] = useState<PurchaseInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [skuDialog, setSkuDialog] = useState<{ variantId: number; sku: string } | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  // 整产品币种：从全部 row 的 currency 取多数
  const [productCurrency, setProductCurrency] = useState<Currency>("CNY");
  const [switching, setSwitching] = useState(false);
  // 复用顶栏汇率 API（后端 Redis 1h 缓存）
  const [rate, setRate] = useState<UsdCnyRate | null>(null);

  // 批量选择（按 variantId）+ 批量编辑 popover
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchField, setBatchField] = useState<BatchField | null>(null);
  const [batchValue, setBatchValue] = useState("");
  const [batchApplying, setBatchApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await purchaseApi.getByProduct(productId);
      setRows(r);
      const next: Record<number, Draft> = {};
      r.forEach((row) => (next[row.variantId] = toDraft(row)));
      setDrafts(next);
      setProductCurrency(majorityCurrency(r));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  // 进 tab 拉一次汇率；后端缓存 1h，重复打不贵
  useEffect(() => {
    let alive = true;
    utilApi.usdCnyRate()
      .then((r) => {
        if (alive) setRate(r);
      })
      .catch(() => {
        if (alive) setRate({ rate: null, fetchedAt: Date.now(), source: "error" });
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 一键切币种：把当前产品下所有 purchase row 的 currency 字段统一对齐到 next。
   *  数值不动（DB 不做汇率换算 — 用户根据顶部参考汇率自行决定是否重输金额）。 */
  async function switchProductCurrency(next: Currency) {
    if (next === productCurrency) return;
    if (rows.length === 0) {
      setProductCurrency(next);
      return;
    }
    const dirty = rows.filter((r) => (r.currency ?? "CNY") !== next);
    if (dirty.length === 0) {
      setProductCurrency(next);
      return;
    }
    setSwitching(true);
    try {
      await Promise.all(
        dirty.map((r) =>
          purchaseApi.updateVariant(r.variantId, { currency: next })
        )
      );
      setProductCurrency(next);
      toast.success(`已切换为 ${next}（${dirty.length} 行同步）`);
      load();
    } catch {
      /* 单条失败由全局 toast 提示；不阻塞 UI */
    } finally {
      setSwitching(false);
    }
  }

  // 顶栏汇率展示
  const rateLabel = useMemo(() => {
    if (!rate || rate.rate == null) return "汇率获取中…";
    return `1 USD = ${Number(rate.rate).toFixed(4)} CNY`;
  }, [rate]);

  function setField(variantId: number, k: keyof Draft, v: string) {
    setDrafts((d) => ({ ...d, [variantId]: { ...d[variantId], [k]: v } }));
  }

  // ===== 批量选择 / 批量编辑 =====
  const allChecked = rows.length > 0 && selectedIds.size === rows.length;
  const indeterminate = selectedIds.size > 0 && selectedIds.size < rows.length;

  function toggleAll() {
    if (allChecked) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map((r) => r.variantId)));
  }
  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setBatchField(null);
    setBatchValue("");
  }

  /** 串行循环 updateVariant；汇总成功 / 失败计数。 */
  async function applyBatch() {
    if (!batchField || selectedIds.size === 0) return;
    const raw = batchValue.trim();
    if (raw === "" && batchField !== "logisticsTags") {
      toast.warn("请输入新值");
      return;
    }
    const ids = [...selectedIds];
    setBatchApplying(true);
    let ok = 0;
    let fail = 0;
    const patch: Partial<PurchaseInfo> =
      batchField === "logisticsTags"
        ? { logisticsTags: raw }
        : batchField === "cost"
          ? { cost: raw === "" ? undefined : Number(raw), currency: productCurrency }
          : { grossWeight: raw === "" ? undefined : Number(raw) };
    for (const id of ids) {
      try {
        await purchaseApi.updateVariant(id, patch);
        ok++;
      } catch {
        fail++;
      }
    }
    setBatchApplying(false);
    if (fail === 0) toast.success(`批量更新 ${BATCH_LABEL[batchField]}（${ok}/${ids.length}）`);
    else toast.error(`部分失败：成功 ${ok}，失败 ${fail}`);
    setBatchField(null);
    setBatchValue("");
    setSelectedIds(new Set());
    load();
  }

  async function commit(row: PurchaseInfo) {
    const d = drafts[row.variantId];
    if (!d) return;
    const original = toDraft(row);
    if (
      d.cost === original.cost &&
      d.grossWeight === original.grossWeight &&
      d.logisticsTags === original.logisticsTags &&
      d.purchaseUrl === original.purchaseUrl &&
      d.note === original.note
    ) {
      return;
    }
    const body: Partial<PurchaseInfo> = {
      cost: d.cost === "" ? undefined : Number(d.cost),
      currency: productCurrency,
      grossWeight: d.grossWeight === "" ? undefined : Number(d.grossWeight),
      logisticsTags: d.logisticsTags || undefined,
      purchaseUrl: d.purchaseUrl || undefined,
      note: d.note || undefined,
    };
    try {
      await purchaseApi.updateVariant(row.variantId, body);
      toast.success("采购信息已保存");
      load();
    } catch {
      /* toast 已上报 */
    }
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      {/* 产品级币种切换条：影响整张表所有行；右侧显示实时汇率参考（仅展示，不自动换算金额） */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">采购成本币种</span>
          <div className="inline-flex overflow-hidden rounded border" role="group" aria-label="产品采购币种">
            {(["USD", "CNY"] as const).map((c) => (
              <button
                key={c}
                type="button"
                disabled={switching}
                onClick={() => switchProductCurrency(c)}
                className={
                  "px-3 py-1 text-xs disabled:opacity-50 " +
                  (productCurrency === c
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent")
                }
              >
                {CURRENCY_SYMBOL[c]} {c}
              </button>
            ))}
          </div>
          {switching && (
            <span className="text-xs text-muted-foreground">同步中...</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span
            className="rounded border bg-background px-2 py-1 font-mono tabular-nums text-xs text-muted-foreground"
            title={
              rate?.fetchedAt
                ? `数据源：${rate.source}\n更新于：${new Date(rate.fetchedAt).toLocaleString("zh-CN")}`
                : ""
            }
          >
            实时汇率：{rateLabel}
          </span>
          <span className="text-[11px] text-muted-foreground">
            （仅参考，切换币种不自动换算金额，需自行调整）
          </span>
        </div>
      </div>

      {/* Shopify 风格批量操作条：选中 ≥1 时显示 */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">已选 {selectedIds.size} 项</span>
          <span className="text-muted-foreground">·</span>
          {(["cost", "grossWeight", "logisticsTags"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setBatchField(batchField === f ? null : f)}
              className={
                "rounded border px-2.5 py-1 text-xs transition-colors " +
                (batchField === f
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent")
              }
            >
              {BATCH_LABEL[f]}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {batchField && (
              <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                <span className="text-xs text-muted-foreground">
                  {batchField === "cost"
                    ? `新成本 ${CURRENCY_SYMBOL[productCurrency]}`
                    : batchField === "grossWeight"
                      ? "新克重"
                      : "新标签"}
                </span>
                <input
                  type={batchField === "logisticsTags" ? "text" : "number"}
                  step={batchField === "cost" ? "0.01" : batchField === "grossWeight" ? "0.01" : undefined}
                  value={batchValue}
                  onChange={(e) => setBatchValue(e.target.value)}
                  autoFocus
                  className="w-32 bg-transparent text-sm focus:outline-none"
                  placeholder={batchField === "logisticsTags" ? "液体,带电" : "数值"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !batchApplying) applyBatch();
                  }}
                />
                <button
                  type="button"
                  onClick={applyBatch}
                  disabled={batchApplying}
                  className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {batchApplying ? "..." : "应用"}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-muted-foreground hover:underline"
            >
              取消选择
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-10 px-2 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label="全选"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = indeterminate;
                  }}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-right">采购成本（{CURRENCY_SYMBOL[productCurrency]} {productCurrency}）</th>
              <th className="px-2 py-2 text-right">克重 (g)</th>
              <th className="px-2 py-2 text-left">物流标签</th>
              <th className="px-2 py-2 text-left">采购链接</th>
              <th className="px-2 py-2 text-left">备注</th>
              <th className="px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  暂无采购数据
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const d = drafts[r.variantId] ?? toDraft(r);
              const checked = selectedIds.has(r.variantId);
              return (
                <tr
                  key={r.variantId}
                  className={"border-t " + (checked ? "bg-primary/[0.03]" : "")}
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${r.sku || r.variantId}`}
                      checked={checked}
                      onChange={() => toggleOne(r.variantId)}
                    />
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span>{r.sku || "—"}</span>
                      <button
                        type="button"
                        onClick={() => setSkuDialog({ variantId: r.variantId, sku: r.sku ?? "" })}
                        className="rounded border px-2 py-0.5 text-[11px] hover:bg-accent"
                      >
                        修改
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {CURRENCY_SYMBOL[productCurrency]}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        value={d.cost}
                        onChange={(e) => setField(r.variantId, "cost", e.target.value)}
                        onBlur={() => commit(r)}
                        className={inpSm + " w-24 text-right"}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={d.grossWeight}
                      onChange={(e) => setField(r.variantId, "grossWeight", e.target.value)}
                      onBlur={() => commit(r)}
                      className={inpSm + " w-24 text-right"}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={d.logisticsTags}
                      onChange={(e) => setField(r.variantId, "logisticsTags", e.target.value)}
                      onBlur={() => commit(r)}
                      placeholder="逗号分隔，如：液体,带电"
                      className={inpSm}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={d.purchaseUrl}
                      onChange={(e) => setField(r.variantId, "purchaseUrl", e.target.value)}
                      onBlur={() => commit(r)}
                      placeholder="https://1688..."
                      className={inpSm + " w-full"}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={d.note}
                      onChange={(e) => setField(r.variantId, "note", e.target.value)}
                      onBlur={() => commit(r)}
                      placeholder="备注（可选）"
                      className={inpSm + " w-full"}
                    />
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => commit(r)}
                      className="rounded border px-2 py-1 text-xs hover:bg-accent"
                    >
                      保存
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border bg-background">
        <button
          type="button"
          onClick={() => setLogsOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium hover:bg-accent/50"
        >
          <span>SKU 变更历史</span>
          <span className="text-xs text-muted-foreground">{logsOpen ? "收起" : "展开"}</span>
        </button>
        {logsOpen && (
          <div className="border-t px-4 py-3">
            <SkuLogList rows={rows} />
          </div>
        )}
      </section>

      {skuDialog && (
        <SkuChangeDialog
          open={!!skuDialog}
          onClose={() => setSkuDialog(null)}
          variantId={skuDialog.variantId}
          currentSku={skuDialog.sku}
          onChanged={load}
        />
      )}
    </div>
  );
}

function SkuLogList({ rows }: { rows: PurchaseInfo[] }) {
  const [logs, setLogs] = useState<SkuChangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const all = await Promise.all(rows.map((r) => purchaseApi.skuLog(r.variantId).catch(() => [])));
        if (aborted) return;
        const merged = all
          .flat()
          .sort((a, b) => (b.confirmedAt ?? "").localeCompare(a.confirmedAt ?? ""));
        setLogs(merged);
      } catch (e) {
        if (!aborted) setError((e as ApiError).message);
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [rows]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} />;
  if (logs.length === 0)
    return <p className="py-4 text-center text-xs text-muted-foreground">暂无变更记录</p>;

  return (
    <ol className="space-y-2 text-sm">
      {logs.map((l) => {
        const status = l.syncStatus ? SYNC_BADGE[l.syncStatus] ?? { v: "neutral" as BadgeVariant, label: l.syncStatus } : null;
        return (
          <li
            key={l.id}
            className="rounded-md border-l-2 border-primary/40 bg-muted/20 px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs">
                {(l.oldSku || "—")} → <span className="font-medium">{l.newSku}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {(l.confirmedAt ?? "").replace("T", " ").slice(0, 19)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>操作人 userId={l.changedBy ?? "—"}</span>
              {status && <Badge variant={status.v}>{status.label}</Badge>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
