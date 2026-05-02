"use client";

import { useState } from "react";
import Link from "next/link";
import { passwordResetApi } from "@/lib/api/passwordReset";
import type { ApiError } from "@/lib/api/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Form, FormActions, FormField } from "@/components/ui/Form";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const target = email.trim().toLowerCase();
    try {
      await passwordResetApi.request(target);
      setSubmittedEmail(target);
      setDone(true);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        {done ? (
          <>
            <CardHeader>
              <CardTitle>邮件已发送</CardTitle>
              <CardDescription>
                我们已发送邮件到 {submittedEmail}，请在 30 分钟内打开链接重置密码。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                没收到？请稍候 1~2 分钟再操作；同一邮箱 5 分钟内仅可申请 1 次。
              </p>
            </CardContent>
            <CardFooter>
              <Link
                href="/login"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                ← 返回登录
              </Link>
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>忘记密码</CardTitle>
              <CardDescription>
                输入注册邮箱，我们将发送重置链接（30 分钟内有效）。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form onSubmit={handleSubmit}>
                <FormField label="邮箱" required htmlFor="email" error={error}>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    placeholder="you@example.com"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </FormField>
                <FormActions>
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {busy ? "发送中..." : "发送重置邮件"}
                  </button>
                </FormActions>
              </Form>
            </CardContent>
            <CardFooter>
              <Link
                href="/login"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                ← 返回登录
              </Link>
            </CardFooter>
          </>
        )}
      </Card>
    </main>
  );
}
