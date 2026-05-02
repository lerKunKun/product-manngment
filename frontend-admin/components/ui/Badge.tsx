import { cn } from "@/lib/utils";

export type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

const VARIANT_CLS: Record<BadgeVariant, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-red-300 bg-red-50 text-red-900",
  info: "border-sky-300 bg-sky-50 text-sky-900",
  neutral: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none",
        VARIANT_CLS[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
