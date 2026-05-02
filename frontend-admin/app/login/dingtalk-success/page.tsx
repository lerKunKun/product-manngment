"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");
    const userId = params.get("userId");
    const username = params.get("username");
    const pwdMustChange = params.get("pwdMustChange") === "true";

    if (accessToken && refreshToken && userId && username) {
      setSession(
        {
          userId: Number(userId),
          username,
          passwordMustChange: pwdMustChange,
        },
        accessToken,
        refreshToken
      );
      router.replace("/dashboard");
    } else {
      router.replace("/login?error=missing-params");
    }
  }, [params, router, setSession]);

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
