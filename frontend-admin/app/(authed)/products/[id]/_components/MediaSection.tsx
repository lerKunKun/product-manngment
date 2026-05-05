"use client";

// TODO i18n: 文案待统一抽取
import { useEffect, useMemo, useRef, useState } from "react";
import { productApi, type ProductImage } from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";
import { FileUploadDropzone } from "@/components/upload/FileUploadDropzone";
import { MediaPreviewLightbox } from "./MediaPreviewLightbox";
import { TagInput } from "./TagInput";

/**
 * 媒体区（F2 子轨道完整版）：
 *  - 拖拽 / 点击多文件上传，先弹标签 + 备注表单再真上传
 *  - 上传后行内 spinner + r2_status badge，3s 轮询 imageList 直到无 PENDING（≤ 60s）
 *  - 图片：点击大图 lightbox 预览
 *  - 视频：内联 <video controls poster={thumbnailUrl}>
 *  - ❌ 删除（保留旧逻辑）
 *  - HTML5 拖拽排序（保留旧逻辑）
 */

type PendingFile = {
  tmpId: string; // 上传请求级 id（前端临时）
  file: File;
};

type DraftFormState = {
  files: PendingFile[];
  tags: string[];
  remark: string;
};

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60_000;

export function MediaSection({
  productId,
  images,
  onChange,
}: {
  productId: number;
  images: ProductImage[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [order, setOrder] = useState<ProductImage[]>(images);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftFormState | null>(null);
  const [preview, setPreview] = useState<{ src: string; mime: string; alt?: string; poster?: string | null } | null>(null);

  // 轮询管理
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartAt = useRef<number>(0);

  // 父组件 reload 时同步 order：仅当 ID 列表真正变了才覆盖。
  // 不能在 render 期间用首/尾 id 比较然后 setOrder——拖动首图或尾图的 onDragOver 会
  // 立刻让 order[0]/order[last] 对不上 images[0]/images[last]，下一次 render 直接被
  // 抢回，首尾图就永远拖不动。
  const imagesKey = useMemo(() => images.map((i) => i.id).join(","), [images]);
  useEffect(() => {
    setOrder(images);
    // images 引用变但 imagesKey 没变（同一组 id 同序）时不需要 reset。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagesKey]);

  // 已有 tags 集合（自动补全 suggest）
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const img of images) (img.tags ?? []).forEach((t) => s.add(t));
    return Array.from(s);
  }, [images]);

  // 卸载时停轮询
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  function startPolling() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollStartAt.current = Date.now();
    schedulePoll();
  }
  function schedulePoll() {
    pollTimer.current = setTimeout(async () => {
      try {
        const list = await productApi.imageList(productId);
        setOrder(list);
        const stillPending = list.some((i) => i.r2Status === "PENDING" || i.r2Status === "UPLOADING");
        const elapsed = Date.now() - pollStartAt.current;
        if (stillPending && elapsed < POLL_TIMEOUT_MS) {
          schedulePoll();
        } else {
          // 通知父组件最终一次刷新
          onChange();
        }
      } catch {
        // 轮询失败静默
        const elapsed = Date.now() - pollStartAt.current;
        if (elapsed < POLL_TIMEOUT_MS) schedulePoll();
      }
    }, POLL_INTERVAL_MS);
  }

  function onPickFiles(files: File[]) {
    setErr("");
    setDraft({
      files: files.map((f, i) => ({ tmpId: `${Date.now()}-${i}`, file: f })),
      tags: [],
      remark: "",
    });
  }

  async function commitUpload() {
    if (!draft) return;
    if (draft.tags.length === 0) {
      setErr("标签必填，至少填一个");
      return;
    }
    if (draft.files.length === 0) {
      setDraft(null);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      // 顺序上传，避免后端 INSERT position 冲突
      for (const pf of draft.files) {
        await productApi.uploadImageV2(productId, pf.file, draft.tags, draft.remark || undefined);
      }
      setDraft(null);
      // 上传成功立即拉一次 + 启动轮询
      onChange();
      startPolling();
    } catch (e) {
      setErr((e as ApiError).message ?? "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function del(img: ProductImage) {
    if (!confirm(`删除 #${img.id}？（不会删除 R2 文件）`)) return;
    try {
      await productApi.imageDelete(img.id);
      onChange();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  function onDragStart(idx: number) {
    setDragIndex(idx);
  }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    const next = [...order];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(idx, 0, moved);
    setOrder(next);
    setDragIndex(idx);
  }
  async function onDragEnd() {
    setDragIndex(null);
    if (order.length === 0) return;
    const ids = order.map((i) => i.id);
    const original = images.map((i) => i.id).join(",");
    if (ids.join(",") === original) return;
    try {
      await productApi.imageReorder(productId, ids);
      onChange();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  function openPreview(img: ProductImage) {
    if (img.r2Status !== "DONE" || !img.src) return;
    const isVideo = img.mediaType === "VIDEO";
    setPreview({
      src: img.src,
      mime: isVideo ? "video/mp4" : "image/jpeg",
      alt: img.altText ?? `#${img.id}`,
      poster: img.thumbnailUrl ?? null,
    });
  }

  function badgeClass(s?: ProductImage["r2Status"]) {
    switch (s) {
      case "DONE":
        return "bg-emerald-500/15 text-emerald-700";
      case "FAILED":
        return "bg-destructive/20 text-destructive";
      case "UPLOADING":
        return "bg-amber-500/20 text-amber-800";
      case "PENDING":
      default:
        return "bg-muted text-muted-foreground";
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">媒体</h2>
        <span className="text-xs text-muted-foreground">{order.length} 项</span>
      </div>

      {/* 拖拽区 */}
      {!draft && (
        <FileUploadDropzone
          accept="image/*,video/*"
          multiple
          disabled={busy}
          hint="支持图片 / 视频；多文件可同时拖拽。上传后会显示 R2 推送进度（PENDING → UPLOADING → DONE）"
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
            {draft.files.map((f) => (
              <li key={f.tmpId}>
                · {f.file.name} <span className="text-[10px]">({(f.file.size / 1024 / 1024).toFixed(2)} MB)</span>
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
              onChange={(e) => setDraft({ ...draft, remark: e.target.value })}
              rows={2}
              className="w-full resize-none rounded border px-2 py-1 text-xs"
              placeholder="例如：来源 / 摄影师 / 用途"
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

      {err && <p className="text-xs text-destructive">{err}</p>}

      {/* 网格 */}
      {order.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-xs text-muted-foreground">
          暂无媒体
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {order.map((img, idx) => {
            const isVideo = img.mediaType === "VIDEO";
            const ready = img.r2Status === "DONE" && !!img.src;
            return (
              <div
                key={img.id}
                draggable={ready}
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                className={
                  "group relative overflow-hidden rounded border bg-muted/20 " +
                  (dragIndex === idx ? "ring-2 ring-primary opacity-70" : "")
                }
              >
                {/* 媒体本体 */}
                <div
                  className="aspect-square w-full cursor-pointer overflow-hidden"
                  onClick={() => openPreview(img)}
                >
                  {!ready ? (
                    <div className="grid h-full place-items-center bg-muted">
                      <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                        <span>{isVideo ? "视频" : "图片"} 上传中</span>
                      </div>
                    </div>
                  ) : isVideo ? (
                    <video
                      src={img.src}
                      poster={img.thumbnailUrl ?? undefined}
                      muted
                      preload="metadata"
                      className="h-full w-full object-cover"
                    >
                      <track kind="captions" />
                    </video>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.src}
                      alt={img.altText ?? ""}
                      className="h-full w-full cursor-move object-cover"
                    />
                  )}
                </div>

                {/* 主图标 */}
                {idx === 0 && ready && (
                  <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    主图
                  </span>
                )}

                {/* 状态 badge */}
                <span
                  className={
                    "absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] " + badgeClass(img.r2Status)
                  }
                  title={img.r2Error ?? undefined}
                >
                  {img.r2Status ?? "DONE"}
                </span>

                {/* 视频角标 */}
                {isVideo && (
                  <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                    视频
                  </span>
                )}

                {/* 删除按钮 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    del(img);
                  }}
                  className="absolute right-1 top-1 hidden h-6 w-6 place-items-center rounded-full bg-background/90 text-xs text-destructive shadow group-hover:grid"
                  aria-label="删除"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <MediaPreviewLightbox
          open={!!preview}
          src={preview.src}
          mime={preview.mime}
          alt={preview.alt}
          poster={preview.poster}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
