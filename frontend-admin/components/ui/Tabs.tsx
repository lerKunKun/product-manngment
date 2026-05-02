"use client";

import { cn } from "@/lib/utils";

export type TabItem = { value: string; label: React.ReactNode; disabled?: boolean };

export function Tabs({
  items,
  value,
  onChange,
  className,
  children,
}: {
  items: TabItem[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <TabsList>
        {items.map((it) => (
          <TabsTrigger
            key={it.value}
            value={it.value}
            currentValue={value}
            onSelect={() => !it.disabled && onChange(it.value)}
            disabled={it.disabled}
          >
            {it.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </div>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-1 border-b", className)}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  currentValue,
  onSelect,
  disabled,
  children,
}: {
  value: string;
  currentValue: string;
  onSelect: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const active = value === currentValue;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  currentValue,
  children,
  className,
}: {
  value: string;
  currentValue: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (value !== currentValue) return null;
  return <div className={className}>{children}</div>;
}
