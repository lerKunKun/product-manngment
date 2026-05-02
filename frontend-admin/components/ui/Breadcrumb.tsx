import Link from "next/link";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = { href?: string; label: React.ReactNode };

export function Breadcrumb({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav
      aria-label="breadcrumb"
      className={cn("flex flex-wrap items-center gap-1 text-xs text-muted-foreground", className)}
    >
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {it.href && !last ? (
              <Link href={it.href} className="hover:text-foreground">
                {it.label}
              </Link>
            ) : (
              <span className={cn(last && "font-medium text-foreground")}>
                {it.label}
              </span>
            )}
            {!last && <span aria-hidden>/</span>}
          </span>
        );
      })}
    </nav>
  );
}
