"use client";

// TODO i18n
import { useEffect, useState } from "react";
import { productApi, type ProductDoc } from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { FileUploadDropzone } from "@/components/upload/FileUploadDropzone";
import { useToast } from "@/components/ui/Toast";
import { TagInput } from "./TagInput";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * 媒体 / 需求文档子 tab。一份富文本需求文档 + 多个 R2 文件。
 * 文件上传走与产品图片相同的 UI：拖拽 dropzone + 必填 tag + 选填备注。
 */
export function DocsTab({ productId }: { productId: number }) {
  const toast = useToast();
  const [list, setList] = useState<ProductDoc[]>([]);
  const [richHtml, setRichHtml] = useState("");
  const [richTitle, setRichTitle] = useState("需求文档");

  // 上传草稿（点完拖拽 → 弹标签/备注表单 → 确认上传）
  type Draft = { files: File[]; tags: string[]; remark: string };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

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

  // 已有 doc 上的 tag 全集（供 TagInput suggest）
  const allTags = Array.from(
    new Set(
      list
        .filter((d) => d.type === "FILE")
        .flatMap((d) => (Array.isArray(d.tags) ? d.tags : []))
    )
  );

  function onPickFiles(files: File[]) {
    setDraft({ files, tags: [], remark: "" });
  }

  async function commitUpload() {
    if (!draft) return;
    if (draft.tags.length === 0) {
      toast.warn("请至少添加一个标签");
      return;
    }
    setBusy(true);
    try {
      for (const f of draft.files) {
        await productApi.docUpload(productId, f, draft.tags, draft.remark);
      }
      toast.success("文件已上传到 R2");
      setDraft(null);
      load();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveRich() {
    try {
      const exist = list.find((d) => d.type === "RICH_TEXT");
      await productApi.docSaveRich(productId, richHtml, richTitle, exist?.id);
      toast.success("富文本已保存");
      load();
    } catch (e) {
      toast.error((e as ApiError).message);
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
      toast.success("已删除");
      load();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  return (
    <div className="space-y-5">
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

      <section className="rounded-lg border bg-background p-4 space-y-3">
        <h3 className="text-sm font-medium">
          媒体文件（图片/视频/PDF/Office，上传 R2）
        </h3>

        {/* 拖拽区 */}
        {!draft && (
          <FileUploadDropzone
            multiple
            disabled={busy}
            hint="支持图片 / 视频 / PDF / Office；多文件可同时拖拽。上传 R2 后下载前会经病毒扫描占位检查。"
            onFiles={onPickFiles}
          />
        )}

        {/* 标签 + 备注表单 */}
        {draft && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="text-xs font-medium">
              待上传 {draft.files.length} 个文件 — 填标签 / 备注后点击「确认上传」
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-auto">
              {draft.files.map((f, i) => (
                <li key={i}>
                  · {f.name}{" "}
                  <span className="text-[10px]">
                    ({(f.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-1">
              <label className="text-xs font-medium">标签 *（必填）</label>
              <TagInput
                value={draft.tags}
                onChange={(next) => setDraft({ ...draft, tags: next })}
                suggestions={allTags}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">备注（选填）</label>
              <textarea
                value={draft.remark}
                onChange={(e) =>
                  setDraft({ ...draft, remark: e.target.value })
                }
                rows={2}
                className="w-full resize-none rounded border px-2 py-1 text-xs"
                placeholder="例如：需求来源 / 用途 / 版本说明"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={commitUpload}
                disabled={busy}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? "上传中..." : "确认上传"}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={busy}
                className="rounded-md border px-3 py-1 text-xs"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 已上传文件列表 */}
        <ul className="space-y-2">
          {list
            .filter((d) => d.type === "FILE")
            .map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded border bg-muted/20 p-2 text-sm"
              >
                <span className="flex-1 truncate">
                  {d.title || d.fileName}
                  {Array.isArray(d.tags) && d.tags.length > 0 && (
                    <span className="ml-2 inline-flex flex-wrap gap-1">
                      {d.tags.map((t: string) => (
                        <span
                          key={t}
                          className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                        >
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
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
          {list.filter((d) => d.type === "FILE").length === 0 && !draft && (
            <li className="py-3 text-center text-xs text-muted-foreground">
              暂无文件
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
