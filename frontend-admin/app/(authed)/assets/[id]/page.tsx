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
  type FilesPage,
  type FilesPageItem,
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

type Category = FilesPageItem["category"];

const CATEGORY_LABEL: Record<Category, string> = {
  theme: "主题代码",
  image: "图片",
  video: "视频",
  font: "字体",
  data: "数据 JSON",
  other: "其他",
};

/** Tab 显示顺序；"全部"由 UI 单独处理。 */
const CATEGORY_ORDER: Category[] = ["theme", "image", "video", "font", "data", "other"];

const PAGE_SIZE = 50;

export default function AssetSnapshotDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const toast = useToast();

  const [d, setD] = useState<AssetSnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** AS3 之后 worker 按段写 manifest.json；本页改用 /files-page 端点走 DB 分页，
   *  首次访问时后端会从 R2 manifest 懒填充到 asset_snapshot_entry，后续请求纯 SQL。 */
  const [filesPage, setFilesPage] = useState<FilesPage | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);

  const [manifest, setManifest] = useState<unknown>(null);
  const [manifestLoading, setManifestLoading] = useState(false);

  /** 当前激活的分类 tab；null = "全部"。 */
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  /** 当前页码（1-based）。切换分类时会自动回 1。 */
  const [page, setPage] = useState(1);

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
  }

  /** 拉当前 tab + 当前页的文件 entries。切 tab/翻页都会触发。 */
  async function loadFilesPage() {
    setFilesLoading(true);
    try {
      const r = await assetApi.filesPage(id, {
        category: activeCategory ?? undefined,
        page,
        size: PAGE_SIZE,
      });
      setFilesPage(r);
    } catch {
      // 段未生成（早期 snapshot 或 RUNNING 中）— 不报错，下方显示 fallback
      setFilesPage(null);
    } finally {
      setFilesLoading(false);
    }
  }

  /** Tab/Page 变化时重新拉数据。 */
  useEffect(() => {
    if (id) loadFilesPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, activeCategory, page]);

  /** 后端返回的"全分类计数"——和当前 tab 无关，所以一直显示正确总数。 */
  const categoryCounts: Record<Category, number> = useMemo(() => {
    const c = filesPage?.categoryCounts ?? {};
    return {
      theme: c.theme ?? 0,
      image: c.image ?? 0,
      video: c.video ?? 0,
      font: c.font ?? 0,
      data: c.data ?? 0,
      other: c.other ?? 0,
    };
  }, [filesPage]);

  /** 全部文件数 = 所有 category 之和（这台 tab 的徽章 + 空态判断都用）。 */
  const totalAll = useMemo(
    () => Object.values(categoryCounts).reduce((a, b) => a + b, 0),
    [categoryCounts]
  );

  const items: FilesPageItem[] = filesPage?.items ?? [];
  const totalPages = Math.max(1, filesPage?.totalPages ?? 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const totalThisFilter = filesPage?.total ?? 0;

  /** 切换 tab 时回到第 1 页 */
  function selectCategory(c: Category | null) {
    setActiveCategory(c);
    setPage(1);
  }

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
            文件列表 ({totalAll || d.files?.length || 0})
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
        {filesLoading && !filesPage ? (
          <div className="py-3 text-center text-xs text-muted-foreground">
            正在读取文件清单...
          </div>
        ) : totalAll > 0 ? (
          <>
            {/* 分类 tabs */}
            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              <CategoryTab
                label="全部"
                count={totalAll}
                active={activeCategory === null}
                onClick={() => selectCategory(null)}
              />
              {CATEGORY_ORDER.map((c) => (
                <CategoryTab
                  key={c}
                  label={CATEGORY_LABEL[c]}
                  count={categoryCounts[c]}
                  active={activeCategory === c}
                  onClick={() => selectCategory(c)}
                  disabled={categoryCounts[c] === 0}
                />
              ))}
              {filesLoading && (
                <span className="self-center text-[10px] text-muted-foreground">加载中…</span>
              )}
            </div>

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
                  {items.map((e) => (
                    <tr key={e.id} className="border-t hover:bg-muted/30">
                      <td className="px-2 py-1.5 text-xs">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                          {SEGMENT_LABEL[e.segment] ?? e.segment}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{e.relativePath}</td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {e.contentType || "-"}
                      </td>
                      <td className="px-2 py-1.5 text-right">{humanBytes(e.size ?? undefined)}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground" title={e.sha256 ?? undefined}>
                        {e.sha256 ? e.sha256.substring(0, 12) + "…" : "-"}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-xs text-muted-foreground">
                        当前分类下没有文件
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页器 */}
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <div>
                共 {totalThisFilter} 条
                {totalThisFilter > 0 && (
                  <>
                    {" "}· 第 {(safePage - 1) * PAGE_SIZE + 1}–
                    {Math.min(safePage * PAGE_SIZE, totalThisFilter)} 条
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage <= 1 || filesLoading}
                  className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  上一页
                </button>
                <span className="px-1">
                  第 {safePage} / {totalPages} 页
                </span>
                <button
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= totalPages || filesLoading}
                  className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  下一页
                </button>
              </div>
            </div>
          </>
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

function CategoryTab({
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  // 空分类禁用 + 半透明，避免误点；激活态用 primary 高亮
  const base =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition-colors";
  const cls = active
    ? "border-primary bg-primary text-primary-foreground"
    : disabled
      ? "border-zinc-200 text-zinc-400 cursor-not-allowed"
      : "hover:bg-accent";
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`${base} ${cls}`}
    >
      <span>{label}</span>
      <span
        className={
          active
            ? "rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-mono"
            : "rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
        }
      >
        {count}
      </span>
    </button>
  );
}
