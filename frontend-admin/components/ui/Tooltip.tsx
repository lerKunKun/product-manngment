"use client";

import { cloneElement, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
};

const SIDE_CLS: Record<NonNullable<Props["side"]>, string> = {
  top: "bottom-full left-1/2 mb-1 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-1 -translate-x-1/2",
  left: "right-full top-1/2 mr-1 -translate-y-1/2",
  right: "left-full top-1/2 ml-1 -translate-y-1/2",
};

export function Tooltip({ content, children, side = "top" }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const show = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 200);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };

  const trigger = cloneElement(
    children as React.ReactElement<Record<string, unknown>>,
    {
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
    }
  );

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-white shadow-md",
            SIDE_CLS[side]
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
