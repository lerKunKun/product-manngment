"use client";

// TODO i18n: 文案待统一抽取
import { useState, type KeyboardEvent } from "react";

/**
 * combobox 风格的标签录入（F2 子轨道）。
 *
 * 行为：
 *  - 已有 tags 显示为可删除的 chip
 *  - 输入框：回车 / 逗号 / 中文逗号 触发 add；suggestions 提供已有 tags 自动补全
 *  - props.required = true 时父组件应自行校验「至少 1 个」
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "输入标签后回车（必填）",
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);

  const filtered = suggestions
    .filter((s) => s && !value.includes(s) && (input.trim() === "" || s.toLowerCase().includes(input.trim().toLowerCase())))
    .slice(0, 8);

  function add(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (value.includes(t)) {
      setInput("");
      return;
    }
    onChange([...value, t]);
    setInput("");
  }

  function remove(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === "，") {
      e.preventDefault();
      add(input);
    } else if (e.key === "Backspace" && input === "" && value.length > 0) {
      // 退格删最后一个
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="space-y-1">
      <div
        className={
          "flex flex-wrap items-center gap-1 rounded-md border px-2 py-1.5 " +
          (disabled ? "opacity-60" : "focus-within:border-primary")
        }
      >
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs"
          >
            {t}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(t)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`删除 ${t}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => {
            setTimeout(() => setShowSuggest(false), 150);
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          disabled={disabled}
          className="flex-1 min-w-[8rem] border-0 bg-transparent text-xs outline-none"
        />
      </div>
      {showSuggest && filtered.length > 0 && (
        <div className="rounded-md border bg-background shadow-sm">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                add(s);
              }}
              className="block w-full px-2 py-1 text-left text-xs hover:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
