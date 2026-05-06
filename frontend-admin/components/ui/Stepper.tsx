import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepperState = "completed" | "current" | "pending" | "failed";

export type StepperItem = {
  key: string;
  label: string;
  state: StepperState;
};

export function Stepper({
  items,
  className,
}: {
  items: StepperItem[];
  className?: string;
}) {
  return (
    <ol className={cn("flex items-start", className)} aria-label="进度步骤">
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        const prevState = i > 0 ? items[i - 1].state : null;
        const lineLeftCls =
          prevState === "completed"
            ? "bg-emerald-500"
            : "bg-zinc-300 dark:bg-zinc-700";
        const lineRightCls =
          it.state === "completed"
            ? "bg-emerald-500"
            : "bg-zinc-300 dark:bg-zinc-700";
        return (
          <li key={it.key} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <div className="flex flex-1 justify-end">
                {i > 0 && <div className={cn("h-0.5 w-full", lineLeftCls)} />}
              </div>
              <div
                role="img"
                aria-label={`步骤 ${i + 1}：${it.label}（${stateLabel(it.state)}）`}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  it.state === "completed" && "bg-emerald-500 text-white",
                  it.state === "current" &&
                    "border-2 border-blue-500 bg-blue-500 text-white animate-pulse",
                  it.state === "pending" &&
                    "bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
                  it.state === "failed" && "bg-rose-500 text-white"
                )}
              >
                {it.state === "completed" ? (
                  <Check className="h-4 w-4" />
                ) : it.state === "failed" ? (
                  <X className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              <div className="flex flex-1 justify-start">
                {!isLast && <div className={cn("h-0.5 w-full", lineRightCls)} />}
              </div>
            </div>
            <div
              className={cn(
                "mt-2 text-center text-xs",
                it.state === "current"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {it.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function stateLabel(s: StepperState): string {
  return s === "completed"
    ? "已完成"
    : s === "current"
      ? "进行中"
      : s === "failed"
        ? "失败"
        : "待处理";
}
