"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { productApi, type Product } from "@/lib/api/product";
import { useToast } from "@/components/ui/Toast";
import { ErrorBanner, LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  active: { text: "上架", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  draft: { text: "草稿", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  archived: { text: "归档", cls: "bg-zinc-100 text-zinc-500 border-zinc-300" },
};

// Shared grid template — keep header & rows aligned.
const GRID_COLS = "grid-cols-[40px_60px_1fr_2fr_1fr_80px_140px]";

export default function ProductsPage() {
  const [records, setRecords] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toast = useToast();

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 5,
  });

  async function load() {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const r = await productApi.list(page, size, keyword, status);
      setRecords(r.records);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [page, status]);

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
    if (!confirm(`确认批量删除 ${selected.size} 个产品？需要钉钉验证码二次确认。`)) return;
    try {
      await productApi.requestSensitiveCode("PRODUCT_BATCH_DELETE");
      const code = prompt("钉钉收到的 6 位验证码（或看 backend 日志）：");
      if (!code) return;
      const { sensitiveToken } = await productApi.verifySensitive("PRODUCT_BATCH_DELETE", code);
      const r = await productApi.batchDelete(Array.from(selected), sensitiveToken);
      toast.success(`已删除 ${r.deleted} 个产品`);
      load();
    } catch {
      // 错误已由全局 toast 上报
    }
  }

  async function batchStatus(s: "active" | "draft" | "archived") {
    if (!confirm(`确认将 ${selected.size} 个产品状态改为 ${s}？`)) return;
    try {
      const r = await productApi.batchStatus(Array.from(selected), s);
      toast.success(`已更新 ${r.updated} 个产品状态`);
      load();
    } catch {
      // 全局 toast 已处理
    }
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">产品库</h1>
        <div className="flex gap-2">
          <a
            href={productApi.exportUrl()}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            导出 CSV
          </a>
          <Link href="/products/import" className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            导入 CSV
          </Link>
          <Link href="/products/new" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            + 新建产品
          </Link>
        </div>
      </div>

      <form onSubmit={search} className="flex gap-2 text-sm">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索 handle / title / vendor / tags..."
          className="flex-1 rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-md border bg-background px-3 py-2"
        >
          <option value="">全部状态</option>
          <option value="active">上架</option>
          <option value="draft">草稿</option>
          <option value="archived">归档</option>
        </select>
        <button type="submit" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
          搜索
        </button>
      </form>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-md border-2 border-primary bg-primary/5 px-4 py-2 text-sm">
          <span className="font-medium">已选 {selected.size} 项</span>
          <span className="flex-1" />
          <button onClick={() => batchStatus("active")} className="rounded border px-3 py-1 hover:bg-accent">批量上架</button>
          <button onClick={() => batchStatus("draft")} className="rounded border px-3 py-1 hover:bg-accent">批量改草稿</button>
          <button onClick={() => batchStatus("archived")} className="rounded border px-3 py-1 hover:bg-accent">批量归档</button>
          <button onClick={batchDelete} className="rounded border border-destructive px-3 py-1 text-destructive hover:bg-destructive/10">批量删除</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">取消选择</button>
        </div>
      )}

      <ErrorBanner message={error} onRetry={load} />

      {/* Sticky header */}
      <div className="rounded-t-lg border-x border-t bg-muted/50 text-xs uppercase text-muted-foreground">
        <div className={`grid ${GRID_COLS} items-center px-3 py-2`}>
          <div>
            <input
              type="checkbox"
              checked={records.length > 0 && selected.size === records.length}
              onChange={toggleAll}
              aria-label="全选"
            />
          </div>
          <div>ID</div>
          <div>Handle</div>
          <div>标题</div>
          <div>Vendor</div>
          <div>状态</div>
          <div>创建时间</div>
        </div>
      </div>

      {/* Body: loading / empty / virtualized list */}
      {loading ? (
        <div className="rounded-b-lg border-x border-b">
          <LoadingBlock />
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-b-lg border-x border-b p-3">
          <EmptyState
            title="暂无产品"
            hint="点右上角“新建产品”或“导入 CSV”创建第一个产品"
          />
        </div>
      ) : (
        <div ref={parentRef} className="h-[60vh] overflow-auto rounded-b-lg border-x border-b">
          <div
            style={{ height: virtualizer.getTotalSize() }}
            className="relative w-full"
          >
            {virtualItems.map((virtualRow) => {
              const p = records[virtualRow.index];
              const sl = STATUS_LABEL[p.status] ?? STATUS_LABEL.draft;
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
                    `grid ${GRID_COLS} items-center border-t px-3 text-sm hover:bg-muted/30 ` +
                    (checked ? "bg-primary/5" : "")
                  }
                >
                  <div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      aria-label={`选择 ${p.handle}`}
                    />
                  </div>
                  <div>{p.id}</div>
                  <div className="truncate font-mono text-xs">
                    <Link
                      href={`/products/${p.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {p.handle}
                    </Link>
                  </div>
                  <div className="truncate">{p.title}</div>
                  <div className="truncate text-xs">{p.vendor || "-"}</div>
                  <div>
                    <span className={"inline-block rounded border px-2 py-0.5 text-xs " + sl.cls}>
                      {sl.text}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.createdAt ? new Date(p.createdAt).toLocaleString("zh-CN") : "-"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border px-3 py-1 disabled:opacity-50">
            上一页
          </button>
          <span>第 {page} / {Math.max(1, Math.ceil(total / size))} 页</span>
          <button disabled={page * size >= total} onClick={() => setPage((p) => p + 1)} className="rounded-md border px-3 py-1 disabled:opacity-50">
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
