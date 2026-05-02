"use client";

import { cn } from "@/lib/utils";

export function Pagination({
  total,
  page,
  size,
  onChange,
  className,
}: {
  total: number;
  page: number;
  size: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  const last = Math.max(1, Math.ceil(total / size));
  const cur = Math.min(Math.max(1, page), last);

  const pages: (number | "...")[] = [];
  const push = (n: number | "...") => pages.push(n);
  const window = 1;
  for (let i = 1; i <= last; i++) {
    if (
      i === 1 ||
      i === last ||
      (i >= cur - window && i <= cur + window)
    ) {
      push(i);
    } else if (pages[pages.length - 1] !== "...") {
      push("...");
    }
  }

  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <button
        type="button"
        disabled={cur <= 1}
        onClick={() => onChange(cur - 1)}
        className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        上一页
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e${i}`} className="px-1 text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "min-w-[28px] rounded-md border px-2 py-1 text-xs",
              p === cur
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-accent"
            )}
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        disabled={cur >= last}
        onClick={() => onChange(cur + 1)}
        className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        下一页
      </button>
      <span className="ml-2 text-xs text-muted-foreground">共 {total} 条</span>
    </div>
  );
}
