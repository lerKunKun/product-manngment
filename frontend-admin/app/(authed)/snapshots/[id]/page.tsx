"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  productSnapshotApi,
  humanBytes,
  STATUS_BADGE,
  type ProductSnapshotDetail,
} from "@/lib/api/snapshot";
import { LoadingBlock, ErrorBanner, EmptyState } from "@/components/ui/StatusBlocks";

type Tab = "basic" | "price" | "inventory" | "manifest";

export default function ProductSnapshotDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [d, setD] = useState<ProductSnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("basic");

  const [manifest, setManifest] = useState<unknown>(null);
  const [manifestLoaded, setManifestLoaded] = useState(false);
  const [manifestLoading, setManifestLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await productSnapshotApi.detail(id);
      setD(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadManifest() {
    if (manifestLoaded || manifestLoading) return;
    setManifestLoading(true);
    try {
      const m = await productSnapshotApi.manifest(id);
      setManifest(m);
      setManifestLoaded(true);
    } catch {
      // toast 已上报
    } finally {
      setManifestLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (tab === "manifest" && !manifestLoaded) loadManifest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!d || !d.id) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/snapshots")}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← 返回列表
          </button>
        </div>
        <EmptyState title="快照不存在" hint={`id=${id} 未找到`} />
      </div>
    );
  }

  const cls = STATUS_BADGE[d.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";
  const tabs: { k: Tab; label: string }[] = [
    { k: "basic", label: "基本" },
    { k: "price", label: `价格历史 (${d.priceHistory?.length ?? 0})` },
    { k: "inventory", label: `库存历史 (${d.inventoryHistory?.length ?? 0})` },
    { k: "manifest", label: "Manifest" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/snapshots")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回列表
        </button>
        <h1 className="text-2xl font-semibold">产品快照 #{d.id}</h1>
        <span className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}>
          {d.status}
        </span>
        <span className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
          {d.productExternalId}
        </span>
        <span className="flex-1" />
        {d.csvR2Key && (
          <a
            href={productSnapshotApi.csvUrl(d.id)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            下载 CSV
          </a>
        )}
      </div>

      {d.status === "FAILED" && d.errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-medium">失败原因</div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
            {d.errorMessage}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b text-sm">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={
              "border-b-2 px-3 py-2 transition-colors " +
              (tab === t.k
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "basic" && (
        <section className="rounded-lg border bg-background p-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
            <Field label="租户 ID" value={d.tenantId} />
            <Field label="店铺 ID" value={d.storeId} />
            <Field label="Shopify 产品 ID" value={d.productExternalId} mono />
            <Field label="触发来源" value={d.triggerEvent} />
            <Field label="总字节" value={humanBytes(d.totalBytes)} />
            <Field label="CSV key" value={d.csvR2Key || "-"} mono />
            <Field label="JSON key" value={d.jsonR2Key || "-"} mono />
            <Field
              label="创建时间"
              value={d.createdAt ? new Date(d.createdAt).toLocaleString("zh-CN") : "-"}
            />
            <Field
              label="完成时间"
              value={d.completedAt ? new Date(d.completedAt).toLocaleString("zh-CN") : "-"}
            />
          </dl>
        </section>
      )}

      {tab === "price" && (
        <section className="rounded-lg border bg-background p-4 text-sm">
          {!d.priceHistory || d.priceHistory.length === 0 ? (
            <EmptyState title="暂无价格变更" />
          ) : (
            <div className="overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">变体 ID</th>
                    <th className="px-2 py-1.5 text-right">原价</th>
                    <th className="px-2 py-1.5 text-right">现价</th>
                    <th className="px-2 py-1.5 text-right">划线价</th>
                    <th className="px-2 py-1.5 text-left">货币</th>
                    <th className="px-2 py-1.5 text-left">来源</th>
                    <th className="px-2 py-1.5 text-left">变更时间</th>
                  </tr>
                </thead>
                <tbody>
                  {d.priceHistory.map((p) => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-2 py-1.5 font-mono text-xs">
                        {p.variantExternalId || "-"}
                      </td>
                      <td className="px-2 py-1.5 text-right">{p.oldPrice ?? "-"}</td>
                      <td className="px-2 py-1.5 text-right">{p.price ?? "-"}</td>
                      <td className="px-2 py-1.5 text-right">{p.compareAtPrice ?? "-"}</td>
                      <td className="px-2 py-1.5 text-xs">{p.currency || "-"}</td>
                      <td className="px-2 py-1.5 text-xs">{p.source || "-"}</td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {p.changedAt ? new Date(p.changedAt).toLocaleString("zh-CN") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "inventory" && (
        <section className="rounded-lg border bg-background p-4 text-sm">
          {!d.inventoryHistory || d.inventoryHistory.length === 0 ? (
            <EmptyState title="暂无库存变更" />
          ) : (
            <div className="overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">变体 ID</th>
                    <th className="px-2 py-1.5 text-right">原数量</th>
                    <th className="px-2 py-1.5 text-right">现数量</th>
                    <th className="px-2 py-1.5 text-right">变化</th>
                    <th className="px-2 py-1.5 text-left">来源</th>
                    <th className="px-2 py-1.5 text-left">变更时间</th>
                  </tr>
                </thead>
                <tbody>
                  {d.inventoryHistory.map((p) => {
                    const diff =
                      p.inventoryQuantity != null && p.oldQuantity != null
                        ? p.inventoryQuantity - p.oldQuantity
                        : null;
                    return (
                      <tr key={p.id} className="border-t hover:bg-muted/30">
                        <td className="px-2 py-1.5 font-mono text-xs">
                          {p.variantExternalId || "-"}
                        </td>
                        <td className="px-2 py-1.5 text-right">{p.oldQuantity ?? "-"}</td>
                        <td className="px-2 py-1.5 text-right">{p.inventoryQuantity ?? "-"}</td>
                        <td
                          className={
                            "px-2 py-1.5 text-right " +
                            (diff == null
                              ? ""
                              : diff > 0
                                ? "text-emerald-700"
                                : diff < 0
                                  ? "text-red-700"
                                  : "")
                          }
                        >
                          {diff == null ? "-" : diff > 0 ? `+${diff}` : `${diff}`}
                        </td>
                        <td className="px-2 py-1.5 text-xs">{p.source || "-"}</td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">
                          {p.changedAt ? new Date(p.changedAt).toLocaleString("zh-CN") : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "manifest" && (
        <section className="rounded-lg border bg-background p-4 text-sm">
          {manifestLoading && <LoadingBlock />}
          {!manifestLoading && manifestLoaded && manifest != null && (
            <pre className="max-h-[640px] overflow-auto rounded border bg-muted/30 p-3 font-mono text-xs">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          )}
          {!manifestLoading && manifestLoaded && manifest == null && (
            <EmptyState title="manifest 加载失败或为空" />
          )}
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</dd>
    </div>
  );
}
