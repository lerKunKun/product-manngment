"use client";

// TODO i18n: 文案待统一抽取
import { useEffect } from "react";

/**
 * 图片大图 / 视频 / PDF 预览 lightbox（F2 子轨道）。
 *
 * 支持：
 *  - ESC 关闭
 *  - 点遮罩关闭（点内容不关）
 *  - 「下载」按钮直接打开 url（href + download）
 *  - 自动按 mime 判定渲染策略：image → <img>，video → <video controls>，
 *    application/pdf → <iframe>，其他不该走这里（office 不预览）
 */
export function MediaPreviewLightbox({
  open,
  src,
  mime,
  alt,
  poster,
  onClose,
}: {
  open: boolean;
  src: string;
  mime: string;
  alt?: string;
  poster?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isImage = mime.startsWith("image/") || (!mime && /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(src));
  const isVideo = mime.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(src);
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(src);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-xs text-muted-foreground truncate">{alt ?? src}</span>
          <div className="flex items-center gap-2">
            <a
              href={src}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border px-2 py-1 text-xs hover:bg-accent"
            >
              下载
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded border px-2 py-1 text-xs hover:bg-accent"
              aria-label="关闭"
            >
              关闭 (ESC)
            </button>
          </div>
        </div>
        <div className="bg-muted/30 p-2">
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt ?? ""}
              className="max-h-[80vh] max-w-[86vw] object-contain"
            />
          )}
          {isVideo && (
            <video
              src={src}
              controls
              poster={poster ?? undefined}
              className="max-h-[80vh] max-w-[86vw]"
            >
              <track kind="captions" />
            </video>
          )}
          {isPdf && (
            <iframe
              src={src}
              className="h-[80vh] w-[86vw] border-0"
              title={alt ?? "PDF 预览"}
            />
          )}
          {!isImage && !isVideo && !isPdf && (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">
              该类型不支持内联预览，请点击「下载」查看
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
