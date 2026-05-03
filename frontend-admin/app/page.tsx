"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";

export default function HomePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    // 内存里若有 user 占位，先进 dashboard；(authed)/layout 会用 cookie 跑一次 refresh 验真。
    // 没有 user 则直接登录页，少走一跳。
    router.replace(user ? "/dashboard" : "/login");
  }, [hydrated, user, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      正在跳转...
    </main>
  );
}
