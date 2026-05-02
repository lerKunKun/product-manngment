"use client";
import { useEffect, useState } from "react";
import {
  storeProductApi,
  STORE_PRODUCT_STATUS,
  type StoreProductMapping,
} from "@/lib/api/storeProduct";
import { LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";

export function StoreMappingPanel({ productId }: { productId: number }) {
  const [rows, setRows] = useState<StoreProductMapping[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows(await storeProductApi.listForProduct(productId));
    } catch {
      /* global toast handles error */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  if (loading) return <LoadingBlock />;
  if (rows.length === 0)
    return (
      <EmptyState
        title="暂无店铺映射"
        hint="该产品尚未推送到任何店铺。点页头“推送到店铺”发起首次推送。"
      />
    );

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">店铺</th>
            <th className="px-3 py-2 text-left">店铺状态</th>
            <th className="px-3 py-2 text-left">映射状态</th>
            <th className="px-3 py-2 text-left">Shopify Handle</th>
            <th className="px-3 py-2 text-left">Shopify ID</th>
            <th className="px-3 py-2 text-left">最近推送</th>
            <th className="px-3 py-2 text-left">最近拉取</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = STORE_PRODUCT_STATUS[r.status] ?? { text: r.status, cls: "bg-zinc-100" };
            return (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.storeBrand ?? "—"}</div>
                  <div className="text-xs text-muted-foreground font-mono">{r.storeDomain}</div>
                </td>
                <td className="px-3 py-2 text-xs">{r.storeStatus ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={"inline-block rounded border px-2 py-0.5 text-xs " + s.cls}>
                    {s.text}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.shopifyHandle ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.shopifyProductId ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.lastPushedAt ? new Date(r.lastPushedAt).toLocaleString("zh-CN") : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.lastPulledAt ? new Date(r.lastPulledAt).toLocaleString("zh-CN") : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
