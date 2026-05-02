"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { passwordResetApi } from "@/lib/api/passwordReset";
import type { ApiError } from "@/lib/api/client";

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!token) {
      setError("缺少 token，请通过邮件中的链接重新进入。");
      return;
    }
    if (pw1.length < 8) {
      setError("密码至少 8 位。");
      return;
    }
    if (pw1 !== pw2) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      await passwordResetApi.confirm(token, pw1);
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">重置密码</h1>
        <p className="mb-6 text-xs text-muted-foreground">
          请设置新密码，至少 8 位。重置成功后将跳转到登录页。
        </p>

        {!token && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            未检测到 token。请通过邮件中的链接进入此页面。
          </div>
        )}

        {done ? (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              密码已重置，正在跳转到登录页…
            </div>
            <Link
              href="/login"
              className="block w-full rounded-md border bg-background px-4 py-2.5 text-center text-sm hover:bg-accent"
            >
              立即登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">新密码</label>
              <input
                type="password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                required
                autoFocus
                minLength={8}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">确认新密码</label>
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy || !token}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "重置中..." : "确认重置"}
            </button>
            <Link
              href="/login"
              className="block text-center text-xs text-muted-foreground hover:text-foreground"
            >
              返回登录
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          加载中…
        </main>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
