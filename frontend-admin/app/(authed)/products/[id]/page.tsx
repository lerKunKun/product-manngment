"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { productApi, type ProductDetail, type ExternalLink, type PurchaseRow, type ProductDoc, type ProductVariant } from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { SnapshotTriggerDialog } from "@/components/snapshot/SnapshotTriggerDialog";
import { PushTriggerDialog } from "@/components/push/PushTriggerDialog";
import { StoreMappingPanel } from "@/components/product/StoreMappingPanel";
import { PreviewButton } from "@/components/preview/PreviewButton";

type Tab = "basic" | "variants" | "images" | "links" | "purchase" | "docs" | "mapping" | "seo";

const KIND_LABEL: Record<string, string> = { AD: "广告贴", BENCHMARK: "对标页", MATERIAL: "产品素材" };
const inp = "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const inpSm = "rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [d, setD] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("basic");
  const [msg, setMsg] = useState("");
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const r = await productApi.detail(id);
      setD(r);
      setTitle(r.product.title);
      setBodyHtml(r.product.bodyHtml ?? "");
      setVendor(r.product.vendor ?? "");
      setTags(r.product.tags ?? "");
      setSeoTitle(r.product.seoTitle ?? "");
      setSeoDescription(r.product.seoDescription ?? "");
      setStatus(r.product.status);
    } catch (e) { setError((e as ApiError).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function saveBasic() {
    setMsg("");
    try {
      await productApi.update(id, { title, bodyHtml, vendor, tags, status, published: status === "active" });
      setMsg("✓ 已保存");
      load();
    } catch (e) { setMsg((e as ApiError).message); }
  }
  async function saveSeo() {
    setMsg("");
    try { await productApi.update(id, { seoTitle, seoDescription }); setMsg("✓ 已保存"); load(); }
    catch (e) { setMsg((e as ApiError).message); }
  }

  if (loading) return <p className="text-sm text-muted-foreground">加载中...</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!d) return null;

  const tabs: { k: Tab; label: string }[] = [
    { k: "basic", label: "基础" },
    { k: "variants", label: `变体 (${d.variants.length})` },
    { k: "images", label: `图片 (${d.images.length})` },
    { k: "links", label: "外部链接" },
    { k: "purchase", label: "采购信息" },
    { k: "docs", label: "媒体/需求文档" },
    { k: "mapping", label: "店铺映射" },
    { k: "seo", label: "SEO" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/products")} className="text-sm text-muted-foreground hover:text-foreground">← 返回列表</button>
        <h1 className="text-2xl font-semibold">{d.product.title}</h1>
        <span className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">{d.product.handle}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setPushOpen(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
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
        product={{ id: d.product.id, handle: d.product.handle, title: d.product.title }}
      />

      <PushTriggerDialog
        open={pushOpen}
        onClose={() => setPushOpen(false)}
        product={{ id: d.product.id, handle: d.product.handle, title: d.product.title }}
      />


      <div className="flex flex-wrap gap-1 border-b text-sm">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={"border-b-2 px-3 py-2 transition-colors " + (tab === t.k ? "border-primary font-medium" : "border-transparent text-muted-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && <p className={"text-sm " + (msg.startsWith("✓") ? "text-emerald-700" : "text-destructive")}>{msg}</p>}

      {tab === "basic" && (
        <div className="space-y-4 rounded-lg border bg-background p-5">
          <Field label="标题">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inp} />
          </Field>
          <Field label="描述（富文本 / HTML / 预览三模式切换）">
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              onUploadImage={async (f) => (await productApi.uploadDocImage(id, f)).url}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Vendor">
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={inp} />
            </Field>
            <Field label="状态">
              <select value={status} onChange={(e) => setStatus(e.target.value as "draft" | "active" | "archived")} className={inp}>
                <option value="draft">草稿</option>
                <option value="active">上架</option>
                <option value="archived">归档</option>
              </select>
            </Field>
          </div>
          <Field label="Tags（逗号分隔）">
            <input value={tags} onChange={(e) => setTags(e.target.value)} className={inp} />
          </Field>
          <button onClick={saveBasic} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">保存基础信息</button>
        </div>
      )}

      {tab === "variants" && <VariantsTab productId={id} variants={d.variants} onChange={load} setMsg={setMsg} />}
      {tab === "images" && <ImagesTab productId={id} images={d.images} onChange={load} setMsg={setMsg} />}
      {tab === "links" && <LinksTab productId={id} />}
      {tab === "purchase" && <PurchaseTab productId={id} />}
      {tab === "docs" && <DocsTab productId={id} />}
      {tab === "mapping" && <StoreMappingPanel productId={d.product.id} />}
      {tab === "seo" && (
        <div className="max-w-2xl space-y-4 rounded-lg border bg-background p-5">
          <Field label="SEO 标题">
            <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} className={inp} />
          </Field>
          <Field label="SEO 描述">
            <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={3} className={inp} />
          </Field>
          <button onClick={saveSeo} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">保存 SEO</button>
        </div>
      )}
    </div>
  );
}

function VariantsTab({ productId, variants, onChange, setMsg }: { productId: number; variants: ProductVariant[]; onChange: () => void; setMsg: (s: string) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<ProductVariant>>({});

  async function save() {
    if (!editing) return;
    try { await productApi.variantUpdate(editing, draft); setMsg("✓ 变体已保存"); setEditing(null); setDraft({}); onChange(); }
    catch (e) { setMsg((e as ApiError).message); }
  }
  async function addNew() {
    try {
      const r = await productApi.variantCreate(productId, { position: variants.length + 1, sku: `SKU-NEW-${Date.now()}`, price: 0 as unknown as number, inventoryQty: 1000, inventoryPolicy: "continue" });
      setMsg(`✓ 已新增变体 #${r.id}`);
      onChange();
    } catch (e) { setMsg((e as ApiError).message); }
  }
  async function del(v: ProductVariant) {
    if (!confirm(`删除变体 #${v.id} (SKU: ${v.sku})？`)) return;
    try { await productApi.variantDelete(v.id); setMsg("✓ 已删除"); onChange(); }
    catch (e) { setMsg((e as ApiError).message); }
  }
  async function changeSku(v: ProductVariant) {
    const newSku = prompt(`新 SKU（当前 ${v.sku}）：`, v.sku ?? "");
    if (!newSku || newSku === v.sku) return;
    try {
      await productApi.requestSensitiveCode("PURCHASE_SKU_EDIT");
      const code = prompt("钉钉收到的 6 位验证码：");
      if (!code) return;
      const { sensitiveToken } = await productApi.verifySensitive("PURCHASE_SKU_EDIT", code);
      await productApi.changeSku(v.id, newSku, sensitiveToken);
      setMsg("✓ SKU 已变更（log 已落 sku_change_log）");
      onChange();
    } catch (e) { setMsg((e as ApiError).message); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button onClick={addNew} className="rounded border px-3 py-1.5 text-sm hover:bg-accent">+ 新增变体</button>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">Option1</th>
              <th className="px-2 py-2 text-left">Option2</th>
              <th className="px-2 py-2 text-right">价格</th>
              <th className="px-2 py-2 text-right">库存</th>
              <th className="px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              editing === v.id ? (
                <tr key={v.id} className="border-t bg-primary/5">
                  <td className="px-2 py-2">{v.position}</td>
                  <td className="px-2 py-2 font-mono text-xs">{v.sku} <span className="text-muted-foreground text-[10px]">改 SKU 走专用按钮</span></td>
                  <td className="px-2 py-2"><input value={draft.option1 ?? ""} onChange={(e) => setDraft({...draft, option1: e.target.value})} className={inpSm} /></td>
                  <td className="px-2 py-2"><input value={draft.option2 ?? ""} onChange={(e) => setDraft({...draft, option2: e.target.value})} className={inpSm} /></td>
                  <td className="px-2 py-2 text-right"><input type="number" step="0.01" value={String(draft.price ?? 0)} onChange={(e) => setDraft({...draft, price: e.target.value as unknown as number})} className={inpSm + " w-24 text-right"} /></td>
                  <td className="px-2 py-2 text-right"><input type="number" value={draft.inventoryQty ?? 0} onChange={(e) => setDraft({...draft, inventoryQty: Number(e.target.value)})} className={inpSm + " w-20 text-right"} /></td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={save} className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent">保存</button>
                    <button onClick={() => { setEditing(null); setDraft({}); }} className="rounded border px-2 py-1 text-xs hover:bg-accent">取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={v.id} className="border-t">
                  <td className="px-2 py-2">{v.position}</td>
                  <td className="px-2 py-2 font-mono text-xs">{v.sku || "-"}</td>
                  <td className="px-2 py-2">{v.option1 || "-"}</td>
                  <td className="px-2 py-2">{v.option2 || "-"}</td>
                  <td className="px-2 py-2 text-right">{v.price}</td>
                  <td className="px-2 py-2 text-right">{v.inventoryQty ?? 0}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={() => { setEditing(v.id); setDraft(v); }} className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent">编辑</button>
                    <button onClick={() => changeSku(v)} className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent">改 SKU</button>
                    <button onClick={() => del(v)} className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10">删除</button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImagesTab({ productId, images, onChange, setMsg }: { productId: number; images: ProductDetail["images"]; onChange: () => void; setMsg: (s: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  async function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    try { await productApi.uploadImage(productId, f); setMsg("✓ 图片已上传"); if (fileRef.current) fileRef.current.value = ""; onChange(); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="text-sm" />
        <button onClick={upload} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">上传图片</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {images.map((img) => (
          <div key={img.id} className="rounded-lg border bg-background p-2">
            <img src={img.src} alt={img.altText ?? ""} className="aspect-square w-full rounded object-cover" />
            <div className="mt-1 truncate text-xs text-muted-foreground">{img.src.split("/").pop()}</div>
          </div>
        ))}
        {images.length === 0 && <p className="col-span-3 py-6 text-center text-sm text-muted-foreground">暂无图片</p>}
      </div>
    </div>
  );
}

function LinksTab({ productId }: { productId: number }) {
  const [list, setList] = useState<ExternalLink[]>([]);
  const [kind, setKind] = useState<"AD" | "BENCHMARK" | "MATERIAL">("AD");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() { setList(await productApi.linkList(productId)); }
  useEffect(() => { load(); }, [productId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setBusy(true);
    try {
      await productApi.linkCreate(productId, { kind, url, note: note || undefined });
      setUrl(""); setNote(""); load();
    } finally { setBusy(false); }
  }
  async function del(id: number) {
    if (!confirm(`删除链接 #${id}？`)) return;
    await productApi.linkDelete(id); load();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border bg-background p-4">
        <div>
          <label className="mb-1 block text-xs font-medium">类型</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as "AD" | "BENCHMARK" | "MATERIAL")} className={inpSm}>
            <option value="AD">广告贴</option>
            <option value="BENCHMARK">对标页</option>
            <option value="MATERIAL">产品素材</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs font-medium">链接 URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} required className={inpSm + " w-full"} placeholder="https://..." />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs font-medium">备注</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inpSm + " w-full"} />
        </div>
        <button type="submit" disabled={busy} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">+ 添加</button>
      </form>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-left">URL</th>
              <th className="px-3 py-2 text-left">备注</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">暂无链接</td></tr>}
            {list.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2"><span className="rounded border bg-muted px-2 py-0.5 text-xs">{KIND_LABEL[l.kind]}</span></td>
                <td className="px-3 py-2"><a href={l.url} target="_blank" rel="noreferrer" className="break-all text-primary underline-offset-2 hover:underline">{l.url}</a></td>
                <td className="px-3 py-2 text-xs">{l.note || "-"}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => del(l.id)} className="rounded border px-2 py-1 text-xs hover:bg-accent">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">仅记录链接，不抓取内容（隐私 + 反爬合规）。</p>
    </div>
  );
}

function PurchaseTab({ productId }: { productId: number }) {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<PurchaseRow>>({});
  const [msg, setMsg] = useState("");

  async function load() { setRows(await productApi.purchaseList(productId)); }
  useEffect(() => { load(); }, [productId]);

  async function save() {
    if (!editing) return;
    try { await productApi.purchaseUpsert(editing, draft); setMsg("✓ 已保存"); setEditing(null); setDraft({}); load(); }
    catch (e) { setMsg((e as ApiError).message); }
  }

  return (
    <div className="space-y-3">
      {msg && <p className={"text-sm " + (msg.startsWith("✓") ? "text-emerald-700" : "text-destructive")}>{msg}</p>}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">变体</th>
              <th className="px-2 py-2 text-right">售价</th>
              <th className="px-2 py-2 text-right">采购成本</th>
              <th className="px-2 py-2 text-right">克重</th>
              <th className="px-2 py-2 text-left">物流标签</th>
              <th className="px-2 py-2 text-left">采购链接</th>
              <th className="px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">暂无采购数据</td></tr>}
            {rows.map((r) => (
              editing === r.variantId ? (
                <tr key={r.variantId} className="border-t bg-primary/5">
                  <td className="px-2 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-2 py-2 text-xs">{[r.option1, r.option2].filter(Boolean).join("/") || "-"}</td>
                  <td className="px-2 py-2 text-right">{r.price}</td>
                  <td className="px-2 py-2"><input type="number" step="0.01" value={String(draft.cost ?? "")} onChange={(e) => setDraft({...draft, cost: e.target.value as unknown as number})} className={inpSm + " w-24 text-right"} /></td>
                  <td className="px-2 py-2"><input type="number" step="0.01" value={String(draft.grossWeight ?? "")} onChange={(e) => setDraft({...draft, grossWeight: e.target.value as unknown as number})} className={inpSm + " w-20 text-right"} /></td>
                  <td className="px-2 py-2"><input value={draft.logisticsTags ?? ""} onChange={(e) => setDraft({...draft, logisticsTags: e.target.value})} className={inpSm} placeholder='["液体","带电"]' /></td>
                  <td className="px-2 py-2"><input value={draft.purchaseUrl ?? ""} onChange={(e) => setDraft({...draft, purchaseUrl: e.target.value})} className={inpSm} placeholder="1688..." /></td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={save} className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent">保存</button>
                    <button onClick={() => { setEditing(null); setDraft({}); }} className="rounded border px-2 py-1 text-xs hover:bg-accent">取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.variantId} className="border-t">
                  <td className="px-2 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-2 py-2 text-xs">{[r.option1, r.option2].filter(Boolean).join("/") || "-"}</td>
                  <td className="px-2 py-2 text-right">{r.price}</td>
                  <td className="px-2 py-2 text-right">{r.cost ?? "-"}</td>
                  <td className="px-2 py-2 text-right">{r.grossWeight ?? "-"}</td>
                  <td className="px-2 py-2 text-xs">{r.logisticsTags ?? "-"}</td>
                  <td className="px-2 py-2 text-xs">{r.purchaseUrl ? <a href={r.purchaseUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">查看</a> : "-"}</td>
                  <td className="px-2 py-2 text-right">
                    <button onClick={() => { setEditing(r.variantId); setDraft(r); }} className="rounded border px-2 py-1 text-xs hover:bg-accent">编辑</button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">采购信息按变体维度；改 SKU 走"变体 → 改 SKU"按钮（钉钉验证码二次确认）。</p>
    </div>
  );
}

function DocsTab({ productId }: { productId: number }) {
  const [list, setList] = useState<ProductDoc[]>([]);
  const [richHtml, setRichHtml] = useState("");
  const [richTitle, setRichTitle] = useState("需求文档");
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await productApi.docList(productId);
    setList(r);
    const rich = r.find((d) => d.type === "RICH_TEXT");
    if (rich) {
      setRichHtml(rich.richTextJson ?? "");
      setRichTitle(rich.title ?? "需求文档");
    }
  }
  useEffect(() => { load(); }, [productId]);

  async function uploadFile() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    try { await productApi.docUpload(productId, f); setMsg("✓ 文件已上传到 R2"); if (fileRef.current) fileRef.current.value = ""; load(); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function saveRich() {
    try {
      const exist = list.find((d) => d.type === "RICH_TEXT");
      await productApi.docSaveRich(productId, richHtml, richTitle, exist?.id);
      setMsg("✓ 富文本已保存");
      load();
    } catch (e) { setMsg((e as ApiError).message); }
  }
  async function del(d: ProductDoc) {
    if (!confirm(`删除 ${d.title || d.fileName}？` + (d.type === "FILE" ? " 同时删除 R2 对象。" : ""))) return;
    try { await productApi.docDelete(d.id); setMsg("✓ 已删除"); load(); }
    catch (e) { setMsg((e as ApiError).message); }
  }

  return (
    <div className="space-y-5">
      {msg && <p className={"text-sm " + (msg.startsWith("✓") ? "text-emerald-700" : "text-destructive")}>{msg}</p>}

      <section className="rounded-lg border bg-background p-4">
        <h3 className="mb-3 text-sm font-medium">需求文档（富文本）</h3>
        <input value={richTitle} onChange={(e) => setRichTitle(e.target.value)} className={inp + " mb-2"} placeholder="文档标题" />
        <RichTextEditor
          value={richHtml}
          onChange={setRichHtml}
          onUploadImage={async (f) => (await productApi.uploadDocImage(productId, f)).url}
        />
        <button onClick={saveRich} className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">保存需求文档</button>
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="mb-3 text-sm font-medium">媒体文件（图片/视频/PDF/Office，上传 R2）</h3>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" className="text-sm" />
          <button onClick={uploadFile} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">上传</button>
        </div>
        <ul className="mt-3 space-y-2">
          {list.filter((d) => d.type === "FILE").map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded border bg-muted/20 p-2 text-sm">
              <span className="flex-1 truncate">{d.title || d.fileName}</span>
              <span className="text-xs text-muted-foreground">{d.fileMime} · {((d.fileSize ?? 0) / 1024).toFixed(1)} KB</span>
              <a href={d.fileUrl} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 text-xs hover:bg-accent">下载</a>
              <button onClick={() => del(d)} className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10">删除</button>
            </li>
          ))}
          {list.filter((d) => d.type === "FILE").length === 0 && <li className="py-3 text-center text-xs text-muted-foreground">暂无文件</li>}
        </ul>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
