"use client";

/**
 * Track AS4：跨店快照对比页（最小可跑版本）。
 *
 * 流程：
 * 1. 顶部两个店铺下拉 → 自动取各自最新 FULL+SUCCESS 快照
 * 2. 自动 POST /diff/snapshot 拿 manifest 一层 diff
 * 3. summary 卡片 + 按 category 分组的变更树
 * 4. 点击单条 → POST /diff/snapshot/content 拿单文件 unified_diff，渲染到右侧详情面板
 *
 * 历史快照对比（同店两快照）暂未做，留 TODO；最小流程优先。
 */

import { useEffect, useMemo, useState } from "react";
import { storeApi, type StoreItem } from "@/lib/api/store";
import { assetApi, type LatestStoreSnapshot } from "@/lib/api/asset";
import {
  diffApi,
  groupByCategory,
  KIND_BADGE,
  type DiffChange,
  type ManifestDiffResult,
  type ContentDiffItem,
} from "@/lib/api/diff";
import { ErrorBanner, LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";
import { humanBytes, STATUS_BADGE } from "@/lib/api/snapshot";
import { useI18n } from "@/lib/i18n/context";

type SidePick = {
  storeId: number | null;
  latest: LatestStoreSnapshot | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_SIDE: SidePick = { storeId: null, latest: null, loading: false, error: null };

export default function DiffPage() {
  const { t } = useI18n();
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [storesError, setStoresError] = useState<string | null>(null);
  const [storesLoading, setStoresLoading] = useState(true);

  const [left, setLeft] = useState<SidePick>(EMPTY_SIDE);
  const [right, setRight] = useState<SidePick>(EMPTY_SIDE);

  const [diff, setDiff] = useState<ManifestDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [contentItem, setContentItem] = useState<ContentDiffItem | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  // -------------------------------- bootstrap: store list

  useEffect(() => {
    let aborted = false;
    setStoresLoading(true);
    storeApi
      .list()
      .then((rs) => {
        if (aborted) return;
        setStores(rs ?? []);
      })
      .catch((e) => {
        if (aborted) return;
        setStoresError((e as Error).message);
      })
      .finally(() => {
        if (!aborted) setStoresLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, []);

  // -------------------------------- side helpers

  async function pickStore(side: "left" | "right", storeId: number | null) {
    const setter = side === "left" ? setLeft : setRight;
    if (storeId == null) {
      setter(EMPTY_SIDE);
      return;
    }
    setter({ storeId, latest: null, loading: true, error: null });
    try {
      const r = await assetApi.latestForStore(storeId);
      setter({ storeId, latest: r?.latest ?? null, loading: false, error: null });
    } catch (e) {
      setter({ storeId, latest: null, loading: false, error: (e as Error).message });
    }
  }

  // -------------------------------- run diff when both sides ready

  const canDiff = !!(
    left.latest?.id &&
    right.latest?.id &&
    left.latest.id !== right.latest.id &&
    left.latest.status === "SUCCESS" &&
    right.latest.status === "SUCCESS"
  );

  useEffect(() => {
    if (!canDiff) {
      setDiff(null);
      return;
    }
    let aborted = false;
    setDiffLoading(true);
    setDiffError(null);
    setActivePath(null);
    setContentItem(null);
    diffApi
      .diffManifest(left.latest!.id, right.latest!.id)
      .then((r) => {
        if (!aborted) setDiff(r);
      })
      .catch((e) => {
        if (!aborted) setDiffError((e as Error).message);
      })
      .finally(() => {
        if (!aborted) setDiffLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [canDiff, left.latest?.id, right.latest?.id]);

  // -------------------------------- per-row content diff

  async function openContentDiff(c: DiffChange) {
    if (!left.latest?.id || !right.latest?.id) return;
    setActivePath(c.path);
    setContentItem(null);
    setContentError(null);
    setContentLoading(true);
    try {
      const r = await diffApi.diffContent(left.latest.id, right.latest.id, [c.path]);
      const item = r.items[0] ?? null;
      setContentItem(item);
    } catch (e) {
      setContentError((e as Error).message);
    } finally {
      setContentLoading(false);
    }
  }

  const grouped = useMemo(
    () => (diff ? groupByCategory(diff.changes) : {}),
    [diff]
  );

  // -------------------------------- render

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("diff.title")}</h1>
      </div>

      <ErrorBanner message={storesError} />

      {/* store pickers */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SidePicker
          label={t("diff.left")}
          stores={stores}
          loading={storesLoading}
          pick={left}
          onPick={(id) => pickStore("left", id)}
        />
        <SidePicker
          label={t("diff.right")}
          stores={stores}
          loading={storesLoading}
          pick={right}
          onPick={(id) => pickStore("right", id)}
        />
      </div>

      {/* summary */}
      {diffLoading && <LoadingBlock message={t("diff.computing")} />}
      <ErrorBanner message={diffError} onRetry={() => {
        if (left.latest?.id && right.latest?.id) {
          diffApi
            .diffManifest(left.latest.id, right.latest.id)
            .then(setDiff)
            .catch((e) => setDiffError((e as Error).message));
        }
      }} />

      {!diffLoading && !diff && !storesLoading && (
        <EmptyState
          title={t("diff.empty.title")}
          hint={t("diff.empty.hint")}
        />
      )}

      {diff && (
        <>
          <SummaryCard summary={diff.summary} cached={!!diff.cached} t={t} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* changes tree */}
            <div className="lg:col-span-1 space-y-3">
              {Object.keys(grouped).length === 0 && (
                <EmptyState title={t("diff.noChanges")} />
              )}
              {Object.entries(grouped).map(([cat, list]) => (
                <CategoryGroup
                  key={cat}
                  category={cat}
                  list={list}
                  active={activePath}
                  onPick={openContentDiff}
                />
              ))}
            </div>

            {/* content diff panel */}
            <div className="lg:col-span-2">
              <ContentPanel
                path={activePath}
                loading={contentLoading}
                error={contentError}
                item={contentItem}
                t={t}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// =================================================================== sub-views

function SidePicker({
  label,
  stores,
  loading,
  pick,
  onPick,
}: {
  label: string;
  stores: StoreItem[];
  loading: boolean;
  pick: SidePick;
  onPick: (id: number | null) => void;
}) {
  const latest = pick.latest;
  const statusCls = latest
    ? STATUS_BADGE[latest.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300"
    : "";
  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        {pick.loading && <span className="text-xs text-muted-foreground">…</span>}
      </div>
      <select
        value={pick.storeId ?? ""}
        disabled={loading}
        onChange={(e) =>
          onPick(e.target.value === "" ? null : Number(e.target.value))
        }
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">{loading ? "…" : "—"}</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.brandName ? `${s.brandName} (${s.myshopifyDomain})` : s.myshopifyDomain}
          </option>
        ))}
      </select>
      <div className="text-xs text-muted-foreground space-y-0.5">
        {pick.error && <div className="text-red-700">{pick.error}</div>}
        {latest ? (
          <>
            <div>
              snapshot #
              <span className="font-mono">{latest.id}</span>{" "}
              <span
                className={"ml-1 inline-block rounded border px-2 py-0.5 " + statusCls}
              >
                {latest.status}
              </span>
            </div>
            <div>
              files: {latest.fileCount ?? "-"} · {humanBytes(latest.totalBytes)}
            </div>
            <div>
              {latest.completedAt
                ? new Date(latest.completedAt).toLocaleString("zh-CN")
                : "-"}
            </div>
          </>
        ) : pick.storeId == null ? null : (
          <div>no snapshot yet</div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  summary,
  cached,
  t,
}: {
  summary: ManifestDiffResult["summary"];
  cached: boolean;
  t: (k: import("@/lib/i18n/messages").MessageKey) => string;
}) {
  const cells = [
    {
      label: t("diff.summary.added"),
      n: summary.added,
      cls: "bg-emerald-50 text-emerald-900 border-emerald-300",
    },
    {
      label: t("diff.summary.removed"),
      n: summary.removed,
      cls: "bg-red-50 text-red-900 border-red-300",
    },
    {
      label: t("diff.summary.modified"),
      n: summary.modified,
      cls: "bg-amber-50 text-amber-900 border-amber-300",
    },
    {
      label: t("diff.summary.unchanged"),
      n: summary.unchanged,
      cls: "bg-zinc-50 text-zinc-700 border-zinc-300",
    },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {cells.map((c) => (
          <div
            key={c.label}
            className={"rounded-md border px-3 py-2 text-sm " + c.cls}
          >
            <div className="text-xs uppercase opacity-80">{c.label}</div>
            <div className="text-2xl font-semibold">{c.n}</div>
          </div>
        ))}
      </div>
      {cached && (
        <div className="text-xs text-muted-foreground">
          {t("diff.cacheHit")}
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  category,
  list,
  active,
  onPick,
}: {
  category: string;
  list: DiffChange[];
  active: string | null;
  onPick: (c: DiffChange) => void;
}) {
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
        <span>{category}</span>
        <span className="text-xs text-muted-foreground">{list.length}</span>
      </div>
      <ul className="divide-y text-xs">
        {list.map((c) => {
          const cls =
            KIND_BADGE[c.kind as string] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";
          const selected = active === c.path;
          return (
            <li
              key={c.path}
              onClick={() => onPick(c)}
              className={
                "flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-accent " +
                (selected ? "bg-accent" : "")
              }
            >
              <span className={"shrink-0 rounded border px-1.5 py-0.5 " + cls}>
                {c.kind}
              </span>
              <span className="truncate font-mono text-[11px]" title={c.path}>
                {c.path}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ContentPanel({
  path,
  loading,
  error,
  item,
  t,
}: {
  path: string | null;
  loading: boolean;
  error: string | null;
  item: ContentDiffItem | null;
  t: (k: import("@/lib/i18n/messages").MessageKey) => string;
}) {
  if (!path) {
    return (
      <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
        {t("diff.content.empty")}
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-3 py-2 text-sm">
        <span className="font-mono text-xs">{path}</span>
        {item && (
          <span className="ml-2 text-xs text-muted-foreground">
            kind: {item.kind} · sizeA={humanBytes(item.sizeA ?? undefined)} · sizeB={humanBytes(
              item.sizeB ?? undefined
            )}
          </span>
        )}
      </div>
      <div className="p-3">
        {loading && <LoadingBlock message={t("diff.content.loading")} />}
        <ErrorBanner message={error} />
        {item && !loading && (
          <DiffPre preview={item.preview ?? ""} />
        )}
      </div>
    </div>
  );
}

/** Render a unified-diff string with +/- line coloring. */
function DiffPre({ preview }: { preview: string }) {
  const lines = preview.split(/\r?\n/);
  return (
    <pre className="max-h-[60vh] overflow-auto rounded bg-zinc-50 p-3 text-xs leading-5">
      {lines.map((ln, i) => {
        let cls = "";
        if (ln.startsWith("+++") || ln.startsWith("---")) {
          cls = "text-zinc-600 font-semibold";
        } else if (ln.startsWith("+")) {
          cls = "bg-emerald-50 text-emerald-900";
        } else if (ln.startsWith("-")) {
          cls = "bg-red-50 text-red-900";
        } else if (ln.startsWith("@@")) {
          cls = "text-sky-700 font-semibold";
        } else if (ln.startsWith("[")) {
          cls = "text-zinc-500 italic";
        }
        return (
          <div key={i} className={cls}>
            {ln || " "}
          </div>
        );
      })}
    </pre>
  );
}
