"use client";

import { cn } from "@/lib/utils";

type Props = {
  from?: string;
  to?: string;
  onChange: (from: string | undefined, to: string | undefined) => void;
  className?: string;
};

const startOfDay = (d: Date) => { d.setHours(0, 0, 0, 0); return d; };
const endOfDay = (d: Date) => { d.setHours(23, 59, 59, 999); return d; };
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const PRESETS: { label: string; calc: () => [Date, Date] }[] = [
  { label: "今天", calc: () => [startOfDay(new Date()), endOfDay(new Date())] },
  { label: "昨天", calc: () => [startOfDay(daysAgo(1)), endOfDay(daysAgo(1))] },
  { label: "本周", calc: () => { const s = new Date(); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return [startOfDay(s), new Date()]; } },
  { label: "本月", calc: () => { const s = new Date(); s.setDate(1); return [startOfDay(s), new Date()]; } },
  { label: "最近 7 天", calc: () => [daysAgo(7), new Date()] },
  { label: "最近 30 天", calc: () => [daysAgo(30), new Date()] },
];

const toLocalInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function DateRangePicker({ from, to, onChange, className }: Props) {
  const setLocal = (key: "from" | "to", v: string) => {
    const iso = v ? new Date(v).toISOString() : undefined;
    if (key === "from") onChange(iso, to);
    else onChange(from, iso);
  };
  const inputCls = "rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <input type="datetime-local" value={toLocalInput(from)} onChange={(e) => setLocal("from", e.target.value)} className={inputCls} />
      <span className="text-sm text-muted-foreground">至</span>
      <input type="datetime-local" value={toLocalInput(to)} onChange={(e) => setLocal("to", e.target.value)} className={inputCls} />
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => { const [s, e] = p.calc(); onChange(s.toISOString(), e.toISOString()); }}
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
