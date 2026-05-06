"use client";

// TODO i18n: 全文 hardcoded 中文，等 F1 收尾后统一抽到 lib/i18n/messages.ts
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  productApi,
  type Product,
  type ProductDetail,
  type ProductOption,
} from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { SnapshotTriggerDialog } from "@/components/snapshot/SnapshotTriggerDialog";
import { PushTriggerDialog } from "@/components/push/PushTriggerDialog";
import { PreviewButton } from "@/components/preview/PreviewButton";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ExternalLinksBar } from "./_components/ExternalLinksBar";
import { MediaSection } from "./_components/MediaSection";
import { VariantsTable } from "./_components/VariantsTable";
import { RightPanel } from "./_components/RightPanel";
import { DocsTab } from "./_components/DocsTab";
import { PurchaseTab } from "@/components/product/PurchaseTab";
import { StoreMappingPanel } from "@/components/product/StoreMappingPanel";
import { ProductHistoryTabs } from "@/components/product/ProductHistoryTabs";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type SubTab = "purchase" | "docs" | "mapping" | "snapshotHistory" | "pushHistory";
const SUB_TABS: { k: SubTab; label: string }[] = [
  { k: "purchase", label: "采购信息" },
  { k: "docs", label: "媒体/需求文档" },
  { k: "mapping", label: "店铺映射" },
  { k: "snapshotHistory", label: "快照历史" },
  { k: "pushHistory", label: "推送历史" },
];

/**
 * Shopify 化产品详情页：
 * - 顶部 breadcrumb + 标题 + 主操作（保存 / 推送 / 快照 / 预览）
 * - 顶部下方：外部链接 chips bar
 * - 主体两栏：
 *   - 左 ~70%：标题、描述、媒体、变体、SEO + 底部二级 tab（采购/文档/映射/快照历史/推送历史）
 *   - 右 ~30%：Status / Organization / Metafields
 *
 * 用户原诉求只是「变体 + 图片合并到主区、外部链接置顶」，其他 tab 必须保留。
 */
export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const toast = useToast();
  const [d, setD] = useState<ProductDetail | null>(null);
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>("purchase");

  // 编辑中的草稿（commit 一次到后端）
  const [draft, setDraft] = useState<Product | null>(null);
  const [bodyHtml, setBodyHtml] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      // 详情 + options 并发取（后端是分散端点，这里 Promise.all）
      const [detail, opts] = await Promise.all([
        productApi.detail(id),
        productApi.optionList(id).catch(() => [] as ProductOption[]),
      ]);
      setD(detail);
      setOptions(opts);
      setDraft({ ...detail.product });
      setBodyHtml(detail.product.bodyHtml ?? "");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function patchDraft(patch: Partial<Product>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function saveAll() {
    if (!draft) return;
    try {
      await productApi.update(id, {
        title: draft.title,
        bodyHtml,
        vendor: draft.vendor,
        type: draft.type,
        tags: draft.tags,
        status: draft.status,
        published: draft.status === "active",
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        templateSuffix: draft.templateSuffix ?? null,
      });
      toast.success("已保存");
      load();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">加载中...</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!d || !draft) return null;

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ href: "/products", label: "产品库" }, { label: `#${id}` }]}
      />

      {/* 顶部：标题 + 主操作 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{d.product.title}</h1>
        <span className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
          {d.product.handle}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={saveAll}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => setPushOpen(true)}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          推送到店铺
        </button>
        <button
          type="button"
          onClick={() => setSnapshotOpen(true)}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          立即快照
        </button>
        <PreviewButton productId={d.product.id} />
      </div>

      <SnapshotTriggerDialog
        open={snapshotOpen}
        onClose={() => setSnapshotOpen(false)}
        product={{
          id: d.product.id,
          handle: d.product.handle,
          title: d.product.title,
        }}
      />
      <PushTriggerDialog
        open={pushOpen}
        onClose={() => setPushOpen(false)}
        product={{
          id: d.product.id,
          handle: d.product.handle,
          title: d.product.title,
        }}
      />

      {/* 外部链接 chips（标题之上的诉求实际是结构上的"主标题之上"，这里放在大标题下、
          表单之上的 chips bar，符合 Shopify "Status / Tags above title" 的视觉逻辑 ） */}
      <ExternalLinksBar productId={id} />

      {/* 主体两栏 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-10">
        {/* 左主区 ~70% */}
        <div className="space-y-4 lg:col-span-7">
          {/* 标题 + Handle */}
          <section className="space-y-3 rounded-lg border bg-background p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">标题</label>
              <input
                value={draft.title}
                onChange={(e) => patchDraft({ title: e.target.value })}
                className={inp}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">描述</label>
              <RichTextEditor
                value={bodyHtml}
                onChange={setBodyHtml}
                onUploadImage={async (f) =>
                  (await productApi.uploadDocImage(id, f)).url
                }
              />
            </div>
          </section>

          <MediaSection productId={id} images={d.images} onChange={load} />

          <VariantsTable
            productId={id}
            variants={d.variants}
            options={options}
            images={d.images}
            onChange={load}
          />

          {/* SEO */}
          <section className="space-y-3 rounded-lg border bg-background p-5">
            <h2 className="text-sm font-semibold">SEO</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">SEO 标题</label>
              <input
                value={draft.seoTitle ?? ""}
                onChange={(e) => patchDraft({ seoTitle: e.target.value })}
                className={inp}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">SEO 描述</label>
              <textarea
                value={draft.seoDescription ?? ""}
                onChange={(e) => patchDraft({ seoDescription: e.target.value })}
                rows={3}
                className={inp}
              />
            </div>
          </section>

          {/* 二级 tab：采购信息 / 媒体文档 / 店铺映射 / 快照历史 / 推送历史 */}
          <section className="rounded-lg border bg-background">
            <div className="flex flex-wrap gap-1 border-b px-2 py-1.5 text-sm">
              {SUB_TABS.map((t) => (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setSubTab(t.k)}
                  className={
                    "rounded px-3 py-1.5 transition-colors " +
                    (subTab === t.k
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="p-4">
              {subTab === "purchase" && <PurchaseTab productId={id} />}
              {subTab === "docs" && <DocsTab productId={id} />}
              {subTab === "mapping" && <StoreMappingPanel productId={id} />}
              {subTab === "snapshotHistory" && (
                <ProductHistoryTabs productId={id} initialTab="snapshot" />
              )}
              {subTab === "pushHistory" && (
                <ProductHistoryTabs productId={id} initialTab="push" />
              )}
            </div>
          </section>
        </div>

        {/* 右栏 ~30% */}
        <div className="lg:col-span-3">
          <RightPanel
            productId={id}
            product={draft}
            onProductPatch={patchDraft}
          />
        </div>
      </div>
    </div>
  );
}
