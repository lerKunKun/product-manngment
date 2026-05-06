"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info" | "warn";

const TOAST_ICON: Record<ToastKind, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  warn: AlertTriangle,
  info: Info,
};

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
  ttl: number;
};

type ToastApi = {
  show: (kind: ToastKind, message: string, ttlMs?: number) => void;
  success: (m: string, ttlMs?: number) => void;
  error: (m: string, ttlMs?: number) => void;
  info: (m: string, ttlMs?: number) => void;
  warn: (m: string, ttlMs?: number) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

let externalEmit: ((kind: ToastKind, msg: string, ttl?: number) => void) | null =
  null;

/**
 * 命令式调用入口（在普通函数 / lib 层用）：
 *   import { toast } from "@/components/ui/Toast";
 *   toast.error("xxx")
 * 在 React 组件里仍推荐 useToast() 取 hook 版。
 */
export const toast: ToastApi = {
  show(kind, message, ttl) {
    if (externalEmit) externalEmit(kind, message, ttl);
    else if (typeof window !== "undefined") console.warn("[toast]", kind, message);
  },
  success(m, ttl) {
    this.show("success", m, ttl);
  },
  error(m, ttl) {
    this.show("error", m, ttl);
  },
  info(m, ttl) {
    this.show("info", m, ttl);
  },
  warn(m, ttl) {
    this.show("warn", m, ttl);
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (kind: ToastKind, message: string, ttlMs = 3500) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setItems((prev) => [...prev, { id, kind, message, ttl: ttlMs }]);
      window.setTimeout(() => remove(id), ttlMs);
    },
    [remove]
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, ttl) => show("success", m, ttl),
      error: (m, ttl) => show("error", m, ttl),
      info: (m, ttl) => show("info", m, ttl),
      warn: (m, ttl) => show("warn", m, ttl),
    }),
    [show]
  );

  useEffect(() => {
    externalEmit = (k, m, ttl) => show(k, m, ttl);
    return () => {
      externalEmit = null;
    };
  }, [show]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-md backdrop-blur",
              t.kind === "success" &&
                "border-emerald-200 bg-emerald-50 text-emerald-900",
              t.kind === "error" &&
                "border-red-200 bg-red-50 text-red-900",
              t.kind === "info" &&
                "border-slate-200 bg-white text-slate-900",
              t.kind === "warn" &&
                "border-amber-200 bg-amber-50 text-amber-900"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                {(() => {
                  const Icon = TOAST_ICON[t.kind];
                  return <Icon className="mt-0.5 h-4 w-4 shrink-0" />;
                })()}
                <span className="break-words">{t.message}</span>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => remove(t.id)}
                className="text-xs text-current/60 hover:text-current"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    if (typeof window !== "undefined") {
      console.warn("useToast() 必须在 <ToastProvider> 内使用，已降级到 console");
    }
    return toast;
  }
  return ctx;
}
