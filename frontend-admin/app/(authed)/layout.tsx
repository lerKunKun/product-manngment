"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth/store";
import { authApi } from "@/lib/api/auth";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

/** 心跳间隔：被踢端最长 N 秒后下线 */
const HEARTBEAT_MS = 20_000;

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hydrated = useAuthStore((s) => s.hydrated);
  const [booting, setBooting] = useState(true);
  const bootRef = useRef(false);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  // 首屏 boot：等 zustand 从 localStorage hydrate 完，再决定 redirect 还是 refresh
  useEffect(() => {
    if (!hydrated || bootRef.current) return;
    bootRef.current = true;
    (async () => {
      // 内存里若已有 access（同 SPA 内导航），直接通过
      if (useAuthStore.getState().accessToken) {
        setBooting(false);
        return;
      }
      // 否则用 cookie 走一次 refresh 把 access 拉回来
      try {
        const resp = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        const body = await resp.json().catch(() => null);
        if (!body || body.code !== 0 || !body.data) {
          router.replace("/login");
          return;
        }
        const d = body.data;
        useAuthStore.getState().setSession(
          {
            userId: d.userId,
            username: d.username,
            employeeNo: d.employeeNo,
            userType: d.userType,
            passwordMustChange: d.passwordMustChange,
          },
          d.accessToken
        );
        setBooting(false);
      } catch {
        router.replace("/login");
      }
    })();
  }, [hydrated, router]);

  // 心跳：每 20s ping /auth/me；被踢/失效会触发全局 401 处理
  useEffect(() => {
    if (booting) return;
    const t = setInterval(() => {
      authApi.me().catch(() => {
        // me() 已 silent；401 会被 client.ts 的 onUnauthorized 处理
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [booting]);

  if (!hydrated || booting) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        正在恢复登录状态...
      </div>
    );
  }

  if (!user || !accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        正在跳转登录页...
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppShell>
    </QueryClientProvider>
  );
}
