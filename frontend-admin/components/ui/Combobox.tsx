"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
};

export function Combobox({ value, onChange, options, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? "",
    [options, value]
  );
  const filtered = useMemo(() => {
    const q = (open ? query : "").trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const select = (opt: ComboboxOption) => {
    onChange(opt.value);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) select(filtered[active]);
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <input
        type="text"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-background py-1 shadow-md">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); select(o); }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer px-3 py-1.5 text-sm", i === active ? "bg-accent" : "hover:bg-accent")}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
