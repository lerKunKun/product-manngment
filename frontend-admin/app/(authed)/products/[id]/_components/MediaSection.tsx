"use client";

// TODO i18n: 文案待统一抽取
import { useRef, useState } from "react";
import { productApi, type ProductImage } from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";

/**
 * 媒体区：图片网格 + 删除 + 拖拽排序。
 *
 * <p><b>F2 留下批：</b>当前上传走旧的 file input + productApi.uploadImage（仅图片，
 * 一次一张，无进度，不支持视频）。F2 子轨道会替换为：
 * <ul>
 *   <li>多文件 dropzone</li>
 *   <li>视频上传 → 走 R2 直传 + transcoding pipeline</li>
 *   <li>显示进度、断点续传</li>
 * </ul>
 */
export function MediaSection({
  productId,
  images,
  onChange,
}: {
  productId: number;
  images: ProductImage[];
  onChange: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [order, setOrder] = useState<ProductImage[]>(images);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // 父组件 reload 时 images 引用会变；跟随刷新本地排序。
  // 避免引入 useEffect 死循环，用 deps 只依赖 length + 第一个 id。
  if (
    order.length !== images.length ||
    (images.length > 0 && order[0]?.id !== images[0]?.id) ||
    (images.length > 0 && order[order.length - 1]?.id !== images[images.length - 1]?.id)
  ) {
    setOrder(images);
  }

  async function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    setErr("");
    try {
      // TODO F2: 替换为多文件 dropzone + 视频支持
      await productApi.uploadImage(productId, f);
      if (fileRef.current) fileRef.current.value = "";
      onChange();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function del(img: ProductImage) {
    if (!confirm(`删除图片 #${img.id}？（不会删除 R2 文件）`)) return;
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
    // 跟服务端同步顺序（后端按 ids 顺序写 position 1..N）
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

  return (
    <section className="space-y-3 rounded-lg border bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">媒体</h2>
        <span className="text-xs text-muted-foreground">{order.length} 张</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* TODO F2: 替换为 multi-file dropzone + 视频 */}
        <input ref={fileRef} type="file" accept="image/*" className="text-xs" />
        <button
          type="button"
          onClick={upload}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "上传中..." : "上传图片"}
        </button>
        <span className="text-[10px] text-muted-foreground">
          视频上传 / 多文件 / 进度条 留 F2
        </span>
      </div>

      {err && <p className="text-xs text-destructive">{err}</p>}

      {order.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-xs text-muted-foreground">
          暂无媒体。拖拽文件或点击上方上传按钮。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {order.map((img, idx) => (
            <div
              key={img.id}
              draggable
              onDragStart={() => onDragStart(idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDragEnd={onDragEnd}
              className={
                "group relative overflow-hidden rounded border bg-muted/20 " +
                (dragIndex === idx ? "ring-2 ring-primary opacity-70" : "")
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.altText ?? ""}
                className="aspect-square w-full cursor-move object-cover"
              />
              {idx === 0 && (
                <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  主图
                </span>
              )}
              <button
                type="button"
                onClick={() => del(img)}
                className="absolute right-1 top-1 hidden h-6 w-6 place-items-center rounded-full bg-background/90 text-xs text-destructive shadow group-hover:grid"
                aria-label="删除图片"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
