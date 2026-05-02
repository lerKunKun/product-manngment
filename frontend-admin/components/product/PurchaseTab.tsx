"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, ErrorBanner } from "@/components/ui/StatusBlocks";
import { purchaseApi, type PurchaseInfo, type SkuChangeLog } from "@/lib/api/purchase";
import { SkuChangeDialog } from "./SkuChangeDialog";
import type { ApiError } from "@/lib/api/client";

const inpSm =
  "rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type Draft = {
  cost: string;
  weightG: string;
  logisticsTag: string;
  purchaseUrl: string;
};

function toDraft(r: PurchaseInfo): Draft {
  return {
    cost: r.cost == null ? "" : String(r.cost),
    weightG: r.weightG == null ? "" : String(r.weightG),
    logisticsTag: r.logisticsTag ?? "",
    purchaseUrl: r.purchaseUrl ?? "",
  };
}

export function PurchaseTab({ productId }: { productId: number }) {
  const toast = useToast();
  const [rows, setRows] = useState<PurchaseInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [skuDialog, setSkuDialog] = useState<{ variantId: number; sku: string } | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await purchaseApi.getByProduct(productId);
      setRows(r);
      const next: Record<number, Draft> = {};
      r.forEach((row) => (next[row.variantId] = toDraft(row)));
      setDrafts(next);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  function setField(variantId: number, k: keyof Draft, v: string) {
    setDrafts((d) => ({ ...d, [variantId]: { ...d[variantId], [k]: v } }));
  }

  async function commit(row: PurchaseInfo) {
    const d = drafts[row.variantId];
    if (!d) return;
    const original = toDraft(row);
    if (
      d.cost === original.cost &&
      d.weightG === original.weightG &&
      d.logisticsTag === original.logisticsTag &&
      d.purchaseUrl === original.purchaseUrl
    ) {
      return;
    }
    const body: Partial<PurchaseInfo> = {
      cost: d.cost === "" ? undefined : Number(d.cost),
      weightG: d.weightG === "" ? undefined : Number(d.weightG),
      logisticsTag: d.logisticsTag || undefined,
      purchaseUrl: d.purchaseUrl || undefined,
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
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-right">采购成本</th>
              <th className="px-2 py-2 text-right">克重 (g)</th>
              <th className="px-2 py-2 text-left">物流标签</th>
              <th className="px-2 py-2 text-left">采购链接</th>
              <th className="px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  暂无采购数据
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const d = drafts[r.variantId] ?? toDraft(r);
              return (
                <tr key={r.variantId} className="border-t">
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
                    <input
                      type="number"
                      step="0.01"
                      value={d.cost}
                      onChange={(e) => setField(r.variantId, "cost", e.target.value)}
                      onBlur={() => commit(r)}
                      className={inpSm + " w-24 text-right"}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={d.weightG}
                      onChange={(e) => setField(r.variantId, "weightG", e.target.value)}
                      onBlur={() => commit(r)}
                      className={inpSm + " w-24 text-right"}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={d.logisticsTag}
                      onChange={(e) => setField(r.variantId, "logisticsTag", e.target.value)}
                      onBlur={() => commit(r)}
                      placeholder='如 液体/带电'
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
          .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
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
      {logs.map((l) => (
        <li
          key={l.id}
          className="rounded-md border-l-2 border-primary/40 bg-muted/20 px-3 py-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs">
              {(l.oldSku || "—")} → <span className="font-medium">{l.newSku}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {(l.createdAt ?? "").replace("T", " ").slice(0, 19)}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            操作人 userId={l.actorId}
            {typeof l.syncedStoreCount === "number" && (
              <> · 已同步 {l.syncedStoreCount} 家店铺</>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
