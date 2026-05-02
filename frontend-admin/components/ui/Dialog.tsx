"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * 通用模态对话框。点击遮罩或 Esc 关闭；打开期间锁定 body 滚动。
 *
 * 用法：
 *   <Dialog open={open} onClose={() => setOpen(false)} title="标题"
 *           footer={<><button>取消</button><button>确定</button></>}>
 *     ...content...
 *   </Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full max-w-md rounded-lg border bg-background p-5 shadow-xl",
          className
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="mb-3 flex items-start justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        )}
        <div className="space-y-3 text-sm">{children}</div>
        {footer && (
          <div className="mt-4 flex justify-end gap-2 border-t pt-3">{footer}</div>
        )}
      </div>
    </div>
  );
}
