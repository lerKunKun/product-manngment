"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import {
  assetSnapshotApi,
  humanBytes,
  STATUS_BADGE,
  type AssetSnapshotDetail,
} from "@/lib/api/snapshot";
import {
  assetApi,
  parseSyncErrors,
  type SnapshotManifests,
} from "@/lib/api/asset";
import { LoadingBlock, ErrorBanner, EmptyState } from "@/components/ui/StatusBlocks";
import { useToast } from "@/components/ui/Toast";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

const SEGMENT_LABEL: Record<string, string> = {
  theme: "主题",
  product: "产品",
  shop_settings: "店铺设置",
  metafields: "Metafields",
  files: "文件库",
  menu: "菜单",
  policy: "政策",
  collection: "集合",
};

type FlatEntry = {
  segment: string;
  relativePath: string;
  sha256: string;
  size?: number;
  contentType?: string | null;
};

export default function AssetSnapshotDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const toast = useToast();

  const [d, setD] = useState<AssetSnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** AS3 之后 worker 按段写 manifest.json，不再回写 asset_file 表，
   *  详情页改用 /manifests 一次拿所有段，前端展平显示。 */
  const [manifests, setManifests] = useState<SnapshotManifests | null>(null);
  const [manifestsLoading, setManifestsLoading] = useState(false);

  const [manifest, setManifest] = useState<unknown>(null);
  const [manifestLoading, setManifestLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await assetSnapshotApi.detail(id);
      setD(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    setManifestsLoading(true);
    try {
      const m = await assetApi.manifests(id);
      setManifests(m);
    } catch {
      // 段未生成（早期 snapshot 或 RUNNING 中）— 不报错，下方显示 fallback
    } finally {
      setManifestsLoading(false);
    }
  }

  /** 展平 segments → [{segment, relativePath, sha256, size, contentType}] */
  const flatEntries: FlatEntry[] = useMemo(() => {
    if (!manifests?.segments) return [];
    const out: FlatEntry[] = [];
    for (const [seg, data] of Object.entries(manifests.segments)) {
      const entries = (data.entries as
        | { relative_path: string; sha256: string; size?: number; content_type?: string | null }[]
        | undefined) ?? [];
      for (const e of entries) {
        out.push({
          segment: seg,
          relativePath: e.relative_path,
          sha256: e.sha256,
          size: e.size,
          contentType: e.content_type,
        });
      }
    }
    return out;
  }, [manifests]);

  async function loadManifest() {
    setManifestLoading(true);
    try {
      const m = await assetSnapshotApi.manifest(id);
      setManifest(m);
    } catch {
      // 全局 toast 已上报
    } finally {
      setManifestLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!d || !d.id) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[{ href: "/assets", label: "资产快照" }, { label: `#${id}` }]} />
        <EmptyState title="快照不存在" hint={`id=${id} 未找到`} />
      </div>
    );
  }

  const cls = STATUS_BADGE[d.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ href: "/assets", label: "资产快照" }, { label: `#${id}` }]} />
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">资产快照 #{d.id}</h1>
        <span className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}>
          {d.status}
        </span>
        <span className="rounded border bg-muted px-2 py-0.5 text-xs">{d.snapshotType}</span>
      </div>

      {(d.status === "FAILED" || d.status === "PARTIAL") && d.errorMessage && (() => {
        const errs = parseSyncErrors(d.errorMessage);
        const isPartial = d.status === "PARTIAL";
        const cls = isPartial
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-red-200 bg-red-50 text-red-900";
        return (
          <section className={`rounded-md border p-3 text-sm ${cls}`}>
            <div className="mb-2 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-4 w-4" />
              {isPartial ? `失败子任务（${errs.length}）` : "失败原因"}
            </div>
            {errs.length > 0 ? (
              <ul className="space-y-1.5 text-xs">
                {errs.map((e, i) => (
                  <li key={i} className="rounded bg-white/60 p-2">
                    <div className="font-mono font-semibold">{e.label}</div>
                    <div className="mt-0.5 break-all">{e.detail}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {d.errorMessage}
              </pre>
            )}
          </section>
        );
      })()}

      <section className="rounded-lg border bg-background p-4 text-sm">
        <h2 className="mb-3 font-medium">元数据</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
          <Field label="租户 ID" value={d.tenantId} />
          <Field label="店铺 ID" value={d.storeId} />
          <Field label="文件数" value={d.fileCount ?? 0} />
          <Field label="总字节" value={humanBytes(d.totalBytes)} />
          <Field label="R2 prefix" value={d.r2Prefix || "-"} mono />
          <Field
            label="创建时间"
            value={d.createdAt ? new Date(d.createdAt).toLocaleString("zh-CN") : "-"}
          />
          <Field
            label="开始时间"
            value={d.startedAt ? new Date(d.startedAt).toLocaleString("zh-CN") : "-"}
          />
          <Field
            label="完成时间"
            value={d.completedAt ? new Date(d.completedAt).toLocaleString("zh-CN") : "-"}
          />
        </dl>
      </section>

      <section className="rounded-lg border bg-background p-4 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">
            文件列表 ({flatEntries.length || d.files?.length || 0})
          </h2>
          <button
            onClick={() => {
              navigator.clipboard.writeText(d.r2Prefix ?? "");
              toast.success("R2 prefix 已复制");
            }}
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
            disabled={!d.r2Prefix}
          >
            复制 prefix
          </button>
        </div>
        {manifestsLoading ? (
          <div className="py-3 text-center text-xs text-muted-foreground">
            正在读取各段 manifest...
          </div>
        ) : flatEntries.length > 0 ? (
          <div className="overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">段</th>
                  <th className="px-2 py-1.5 text-left">路径</th>
                  <th className="px-2 py-1.5 text-left">MIME</th>
                  <th className="px-2 py-1.5 text-right">大小</th>
                  <th className="px-2 py-1.5 text-left">SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {flatEntries.map((e, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30">
                    <td className="px-2 py-1.5 text-xs">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                        {SEGMENT_LABEL[e.segment] ?? e.segment}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">{e.relativePath}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">
                      {e.contentType || "-"}
                    </td>
                    <td className="px-2 py-1.5 text-right">{humanBytes(e.size)}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground" title={e.sha256}>
                      {e.sha256 ? e.sha256.substring(0, 12) + "…" : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : d.files && d.files.length > 0 ? (
          // 老快照（pre-AS2）asset_file 表回退展示
          <div className="overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">路径</th>
                  <th className="px-2 py-1.5 text-left">MIME</th>
                  <th className="px-2 py-1.5 text-right">大小</th>
                  <th className="px-2 py-1.5 text-left">SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {d.files.map((f) => (
                  <tr key={f.id} className="border-t hover:bg-muted/30">
                    <td className="px-2 py-1.5 font-mono text-xs">{f.relativePath}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">
                      {f.contentType || "-"}
                    </td>
                    <td className="px-2 py-1.5 text-right">{humanBytes(f.sizeBytes)}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                      {f.sha256 ? f.sha256.substring(0, 12) + "…" : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="暂无文件"
            hint={
              d.status === "RUNNING" || d.status === "PENDING"
                ? "尚未完成同步"
                : "该快照所有段都没成功（看上方失败原因），或 backend 未重启使新 endpoint 生效"
            }
          />
        )}
      </section>

      <section className="rounded-lg border bg-background p-4 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Manifest</h2>
          <button
            onClick={loadManifest}
            disabled={manifestLoading}
            className="rounded border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            {manifestLoading ? "加载中…" : "查看 manifest"}
          </button>
        </div>
        {manifest != null && (
          <pre className="max-h-[480px] overflow-auto rounded border bg-muted/30 p-3 font-mono text-xs">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        )}
      </section>
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
