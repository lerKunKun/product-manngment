"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { productApi, type ProductListItem } from "@/lib/api/product";
import { useProducts, useInvalidateProducts } from "@/lib/queries/products";
import { useToast } from "@/components/ui/Toast";
import { ErrorBanner, LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";
import { useI18n } from "@/lib/i18n/context";

// Shared grid template — keep header & rows aligned.
// 列：[checkbox 40] [主图 96] [产品名+ID 1fr] [价格 140] [Badge 160]
const GRID_COLS = "grid-cols-[40px_96px_1fr_140px_160px]";

function formatPrice(price: number | string | null | undefined): string {
  if (price == null) return "-";
  const n = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(n)) return "-";
  return `¥${n.toFixed(2)}`;
}

export default function ProductsPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toast = useToast();

  const { data, isPending, error, refetch } = useProducts({
    page,
    size,
    status,
    q: appliedKeyword,
  });
  const invalidateProducts = useInvalidateProducts();
  const records: ProductListItem[] = data?.records ?? [];
  const total = data?.total ?? 0;

  const parentRef = useRef<HTMLDivElement>(null);
  const ENABLE_VIRTUAL = records.length > 50;
  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    // 卡片化后行更高（96px 缩略图 + padding）
    estimateSize: () => 112,
    overscan: 5,
  });

  function toggle(id: number) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === records.length && records.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(records.map((r) => r.id)));
    }
  }

  async function batchDelete() {
    if (!confirm(t("products.confirmBatchDelete").replace("{count}", String(selected.size)))) return;
    try {
      await productApi.requestSensitiveCode("PRODUCT_BATCH_DELETE");
      const code = prompt(t("products.dingCodePrompt"));
      if (!code) return;
      const { sensitiveToken } = await productApi.verifySensitive("PRODUCT_BATCH_DELETE", code);
      const r = await productApi.batchDelete(Array.from(selected), sensitiveToken);
      toast.success(t("products.batchDeletedToast").replace("{count}", String(r.deleted)));
      setSelected(new Set());
      invalidateProducts();
    } catch {
      // 错误已由全局 toast 上报
    }
  }

  async function batchStatus(s: "active" | "draft" | "archived") {
    if (!confirm(
      t("products.confirmBatchStatus")
        .replace("{count}", String(selected.size))
        .replace("{status}", s)
    )) return;
    try {
      const r = await productApi.batchStatus(Array.from(selected), s);
      toast.success(t("products.batchStatusToast").replace("{count}", String(r.updated)));
      setSelected(new Set());
      invalidateProducts();
    } catch {
      // 全局 toast 已处理
    }
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedKeyword(keyword);
  }

  const virtualItems = virtualizer.getVirtualItems();
  const errorMsg = error ? (error as Error).message : null;

  function renderRowContent(p: ProductListItem, checked: boolean) {
    const shelf = p.shelfStores ?? 0;
    return (
      <>
        <div>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggle(p.id)}
            aria-label={t("products.selectRow").replace("{handle}", p.handle)}
          />
        </div>
        {/*
          主图：故意用 <img> 不用 next/image —— 后端图片域名 (R2 / 用户上传)
          没有事先在 next.config 的 remotePatterns 白名单，next/image 会报错。
        */}
        <div className="flex items-center justify-center">
          {p.mainImageUrl ? (
            <img
              src={p.mainImageUrl}
              alt={p.title}
              className="h-20 w-20 rounded-md border object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">
              {t("products.listCol.noImage")}
            </div>
          )}
        </div>
        {/* 产品名 + ID（保持可点击进入详情） */}
        <div className="min-w-0">
          <Link
            href={`/products/${p.id}`}
            className="block truncate font-semibold text-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            {p.title}
          </Link>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            #{p.id} · {p.handle}
          </div>
        </div>
        {/* 起价 */}
        <div className="font-medium tabular-nums">{formatPrice(p.price)}</div>
        {/* 已上架店铺 / 未上架 Badge */}
        <div>
          {shelf > 0 ? (
            <span className="inline-block rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900">
              {t("products.listCol.shelfActive").replace("{count}", String(shelf))}
            </span>
          ) : (
            <span className="inline-block rounded-full border border-zinc-300 bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
              {t("products.listCol.shelfNone")}
            </span>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("products.title")}</h1>
        <div className="flex gap-2">
          <a
            href={productApi.exportUrl()}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            {t("products.exportCsv")}
          </a>
          <Link href="/products/import" className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            {t("products.importCsv")}
          </Link>
          <Link href="/products/new" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            {t("products.create")}
          </Link>
        </div>
      </div>

      <form onSubmit={search} className="flex gap-2 text-sm">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t("products.searchPlaceholder")}
          className="flex-1 rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-md border bg-background px-3 py-2"
        >
          <option value="">{t("products.statusAll")}</option>
          <option value="active">{t("products.status.active")}</option>
          <option value="draft">{t("products.status.draft")}</option>
          <option value="archived">{t("products.status.archived")}</option>
        </select>
        <button type="submit" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
          {t("products.search")}
        </button>
      </form>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-md border-2 border-primary bg-primary/5 px-4 py-2 text-sm">
          <span className="font-medium">{t("products.selected").replace("{count}", String(selected.size))}</span>
          <span className="flex-1" />
          <button onClick={() => batchStatus("active")} className="rounded border px-3 py-1 hover:bg-accent">{t("products.batch.active")}</button>
          <button onClick={() => batchStatus("draft")} className="rounded border px-3 py-1 hover:bg-accent">{t("products.batch.draft")}</button>
          <button onClick={() => batchStatus("archived")} className="rounded border px-3 py-1 hover:bg-accent">{t("products.batch.archived")}</button>
          <button onClick={batchDelete} className="rounded border border-destructive px-3 py-1 text-destructive hover:bg-destructive/10">{t("products.batch.delete")}</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">{t("products.batch.cancel")}</button>
        </div>
      )}

      <ErrorBanner message={errorMsg} onRetry={() => refetch()} />

      {/* Sticky header */}
      <div className="rounded-t-lg border-x border-t bg-muted/50 text-xs uppercase text-muted-foreground">
        <div className={`grid ${GRID_COLS} items-center px-3 py-2`}>
          <div>
            <input
              type="checkbox"
              checked={records.length > 0 && selected.size === records.length}
              onChange={toggleAll}
              aria-label={t("products.selectAll")}
            />
          </div>
          <div className="text-center">{t("products.listCol.image")}</div>
          <div>{t("products.listCol.name")}</div>
          <div>{t("products.listCol.price")}</div>
          <div>{t("products.listCol.shelf")}</div>
        </div>
      </div>

      {/* Body: loading / empty / virtualized list */}
      {isPending ? (
        <div className="rounded-b-lg border-x border-b">
          <LoadingBlock />
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-b-lg border-x border-b p-3">
          <EmptyState
            title={t("products.empty.title")}
            hint={t("products.empty.hint")}
          />
        </div>
      ) : ENABLE_VIRTUAL ? (
        <div ref={parentRef} className="h-[60vh] overflow-auto rounded-b-lg border-x border-b">
          <div
            style={{ height: virtualizer.getTotalSize() }}
            className="relative w-full"
          >
            {virtualItems.map((virtualRow) => {
              const p = records[virtualRow.index];
              const checked = selected.has(p.id);
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={
                    `grid ${GRID_COLS} items-center gap-3 border-t px-3 text-sm hover:bg-muted/30 ` +
                    (checked ? "bg-primary/5" : "")
                  }
                >
                  {renderRowContent(p, checked)}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-b-lg border-x border-b">
          {records.map((p) => {
            const checked = selected.has(p.id);
            return (
              <div
                key={p.id}
                className={
                  `grid ${GRID_COLS} items-center gap-3 border-t px-3 py-3 text-sm hover:bg-muted/30 ` +
                  (checked ? "bg-primary/5" : "")
                }
              >
                {renderRowContent(p, checked)}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("common.total").replace("{count}", String(total))}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border px-3 py-1 disabled:opacity-50">
            {t("common.prev")}
          </button>
          <span>
            {t("products.pageInfo")
              .replace("{page}", String(page))
              .replace("{total}", String(Math.max(1, Math.ceil(total / size))))}
          </span>
          <button disabled={page * size >= total} onClick={() => setPage((p) => p + 1)} className="rounded-md border px-3 py-1 disabled:opacity-50">
            {t("common.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
