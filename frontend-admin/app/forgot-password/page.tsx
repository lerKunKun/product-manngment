"use client";

import { useState } from "react";
import Link from "next/link";
import { passwordResetApi } from "@/lib/api/passwordReset";
import type { ApiError } from "@/lib/api/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await passwordResetApi.request(email.trim().toLowerCase());
      setDone(true);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">忘记密码</h1>
        <p className="mb-6 text-xs text-muted-foreground">
          输入注册邮箱，我们会发送一个 30 分钟内有效的重置链接。
        </p>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              如果该邮箱已注册，您将很快收到一封重置邮件。请检查收件箱（含垃圾邮件）。
            </div>
            <p className="text-xs text-muted-foreground">
              没收到？请稍候 1~2 分钟再操作；同一邮箱 5 分钟内仅可申请 1 次。
            </p>
            <Link
              href="/login"
              className="block w-full rounded-md border bg-background px-4 py-2.5 text-center text-sm hover:bg-accent"
            >
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "发送中..." : "发送重置邮件"}
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
