"use client";

// TODO i18n
import { useEffect, useRef, useState } from "react";
import { productApi, type ProductDoc } from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";
import { RichTextEditor } from "@/components/editor/RichTextEditor";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * 媒体 / 需求文档子 tab。从原产品详情页 DocsTab 抽出独立组件，
 * 行为保持一致：一份富文本需求文档 + 多个 R2 文件。
 */
export function DocsTab({ productId }: { productId: number }) {
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
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function uploadFile() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    try {
      // F2 把 docUpload 改成 tags 必填；这里走「需求文档」语义，给个默认 tag。
      // TODO: 真正的 tag 输入 UI 等需要做 docs 重构时补 TagInput。
      await productApi.docUpload(productId, f, ["doc"]);
      setMsg("✓ 文件已上传到 R2");
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  }
  async function saveRich() {
    try {
      const exist = list.find((d) => d.type === "RICH_TEXT");
      await productApi.docSaveRich(productId, richHtml, richTitle, exist?.id);
      setMsg("✓ 富文本已保存");
      load();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  }
  async function del(d: ProductDoc) {
    if (
      !confirm(
        `删除 ${d.title || d.fileName}？` +
          (d.type === "FILE" ? " 同时删除 R2 对象。" : "")
      )
    )
      return;
    try {
      await productApi.docDelete(d.id);
      setMsg("✓ 已删除");
      load();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  }

  return (
    <div className="space-y-5">
      {msg && (
        <p
          className={
            "text-sm " +
            (msg.startsWith("✓") ? "text-emerald-700" : "text-destructive")
          }
        >
          {msg}
        </p>
      )}

      <section className="rounded-lg border bg-background p-4">
        <h3 className="mb-3 text-sm font-medium">需求文档（富文本）</h3>
        <input
          value={richTitle}
          onChange={(e) => setRichTitle(e.target.value)}
          className={inp + " mb-2"}
          placeholder="文档标题"
        />
        <RichTextEditor
          value={richHtml}
          onChange={setRichHtml}
          onUploadImage={async (f) =>
            (await productApi.uploadDocImage(productId, f)).url
          }
        />
        <button
          onClick={saveRich}
          className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          保存需求文档
        </button>
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h3 className="mb-3 text-sm font-medium">
          媒体文件（图片/视频/PDF/Office，上传 R2）
        </h3>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" className="text-sm" />
          <button
            onClick={uploadFile}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            上传
          </button>
        </div>
        <ul className="mt-3 space-y-2">
          {list
            .filter((d) => d.type === "FILE")
            .map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded border bg-muted/20 p-2 text-sm"
              >
                <span className="flex-1 truncate">{d.title || d.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {d.fileMime} · {((d.fileSize ?? 0) / 1024).toFixed(1)} KB
                </span>
                <a
                  href={d.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border px-2 py-1 text-xs hover:bg-accent"
                >
                  下载
                </a>
                <button
                  onClick={() => del(d)}
                  className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  删除
                </button>
              </li>
            ))}
          {list.filter((d) => d.type === "FILE").length === 0 && (
            <li className="py-3 text-center text-xs text-muted-foreground">
              暂无文件
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
