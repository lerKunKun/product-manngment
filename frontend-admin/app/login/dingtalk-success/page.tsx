"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";

function Inner() {
  const router = useRouter();

  useEffect(() => {
    // 钉钉回调已把 refresh 写进 httpOnly cookie。这里调 /auth/refresh 凭 cookie 拿新 access + 用户信息。
    (async () => {
      try {
        const resp = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        const body = await resp.json().catch(() => null);
        if (!body || body.code !== 0 || !body.data) {
          router.replace("/login?error=dingtalk-refresh-failed");
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
        router.replace("/dashboard");
      } catch {
        router.replace("/login?error=dingtalk-network");
      }
    })();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      钉钉登录成功，正在跳转...
    </main>
  );
}

export default function DingTalkSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          加载中...
        </main>
      }
    >
      <Inner />
    </Suspense>
  );
}
