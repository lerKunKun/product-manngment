"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function DropdownMenu({
  trigger,
  children,
  align = "right",
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && (
        <ul
          role="menu"
          onClick={() => setOpen(false)}
          className={cn(
            "absolute z-40 mt-1 min-w-[140px] rounded-md border bg-background py-1 shadow-md",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {children}
        </ul>
      )}
    </div>
  );
}

export function DropdownItem({
  onClick,
  variant,
  disabled,
  children,
}: {
  onClick?: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
          variant === "destructive" && "text-red-600 hover:bg-red-50"
        )}
      >
        {children}
      </button>
    </li>
  );
}
