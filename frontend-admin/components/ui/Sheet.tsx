"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "right" | "left";
  children: React.ReactNode;
  className?: string;
};

export function Sheet({ open, onOpenChange, side = "right", children, className }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute top-0 flex h-full w-[400px] flex-col border bg-background shadow-xl md:w-[480px]",
          side === "right" ? "right-0" : "left-0",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col space-y-1.5 border-b p-4">{children}</div>;
}

export function SheetTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}

export function SheetContent({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-auto p-4">{children}</div>;
}

export function SheetFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t p-4">{children}</div>
  );
}
