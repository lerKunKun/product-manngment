"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

function strength(pwd: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
} {
  let s = 0;
  if (pwd.length >= 8) s++;
  if (/[A-Z]/.test(pwd)) s++;
  if (/[0-9]/.test(pwd)) s++;
  if (/[^A-Za-z0-9]/.test(pwd)) s++;
  const labels = ["太弱", "弱", "中等", "强", "很强"];
  const colors = [
    "bg-rose-500",
    "bg-rose-400",
    "bg-amber-400",
    "bg-emerald-400",
    "bg-emerald-600",
  ];
  return {
    score: s as 0 | 1 | 2 | 3 | 4,
    label: labels[s],
    color: colors[s],
  };
}

// 后端约定：token 失效/过期返回特定 code
const TOKEN_INVALID_CODES = new Set([40010, 40011, 40012]);

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [tokenInvalid, setTokenInvalid] = useState(false);

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
    } catch (e) {
      const err = e as ApiError;
      if (TOKEN_INVALID_CODES.has(err.code)) {
        setTokenInvalid(true);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const st = strength(pw1);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        {done ? (
          <>
            <CardHeader>
              <CardTitle>密码已重置</CardTitle>
              <CardDescription>请使用新密码登录。</CardDescription>
            </CardHeader>
            <CardContent>
              <button
                onClick={() => router.push("/login")}
                className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
              >
                立即去登录
              </button>
            </CardContent>
          </>
        ) : tokenInvalid ? (
          <>
            <CardHeader>
              <CardTitle>链接已失效</CardTitle>
              <CardDescription>
                该重置链接已失效或已被使用。请重新发起请求。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <button
                onClick={() => router.push("/forgot-password")}
                className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
              >
                重新发请求
              </button>
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
              <CardTitle>重置密码</CardTitle>
              <CardDescription>
                请设置新密码，至少 8 位。建议包含大小写字母、数字和符号。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!token && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  未检测到 token。请通过邮件中的链接进入此页面。
                </div>
              )}
              <Form onSubmit={handleSubmit}>
                <FormField label="新密码" required htmlFor="pw1">
                  <input
                    id="pw1"
                    type="password"
                    value={pw1}
                    onChange={(e) => setPw1(e.target.value)}
                    required
                    autoFocus
                    minLength={8}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {pw1 && (
                    <div className="mt-2 space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all ${st.color}`}
                          style={{ width: `${(st.score / 4) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        密码强度：{st.label}
                      </p>
                    </div>
                  )}
                </FormField>
                <FormField
                  label="确认新密码"
                  required
                  htmlFor="pw2"
                  error={error}
                >
                  <input
                    id="pw2"
                    type="password"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    required
                    minLength={8}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </FormField>
                <FormActions>
                  <button
                    type="submit"
                    disabled={busy || !token}
                    className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {busy ? "重置中..." : "确认重置"}
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
