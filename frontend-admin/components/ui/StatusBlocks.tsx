import { cn } from "@/lib/utils";

/** 全屏 / 区域加载占位（带 spinner）。 */
export function LoadingBlock({
  message = "加载中…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <Spinner />
      <span>{message}</span>
    </div>
  );
}

/** 行内 / 按钮里的小 spinner。 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]",
        className
      )}
      aria-hidden="true"
    />
  );
}

/** 错误条（页面顶部 / 表单上方）。message 为空时不渲染。 */
export function ErrorBanner({
  message,
  onRetry,
  className,
}: {
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900",
        className
      )}
    >
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs hover:bg-red-100"
        >
          重试
        </button>
      )}
    </div>
  );
}

/** 列表 / 表格的空状态。 */
export function EmptyState({
  title = "暂无数据",
  hint,
  action,
  className,
}: {
  title?: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 text-sm",
        className
      )}
    >
      <div className="font-medium text-foreground">{title}</div>
      {hint && <div className="text-muted-foreground">{hint}</div>}
      {action}
    </div>
  );
}
