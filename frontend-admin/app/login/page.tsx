"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api/auth";
import { useAuthStore } from "@/lib/auth/store";
import type { ApiError } from "@/lib/api/client";

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [tab, setTab] = useState<"password" | "dingtalk">("password");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await authApi.login(username, password);
      setSession(
        {
          userId: r.userId,
          username: r.username,
          employeeNo: r.employeeNo,
          userType: r.userType,
          passwordMustChange: r.passwordMustChange,
        },
        r.accessToken,
        r.refreshToken
      );
      router.push("/dashboard");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDingtalk() {
    setBusy(true);
    setError("");
    try {
      const host = window.location.host;
      const tenant = host.split(".")[0];
      const guess = tenant === "localhost:3000" || tenant === "admin" ? undefined : tenant;
      const r = await authApi.dingtalkQrcode(guess);
      window.location.href = r.oauthUrl;
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">登录</h1>
        <p className="mb-6 text-xs text-muted-foreground">
          Biou × Shopify Control Center
        </p>

        <div className="mb-5 flex border-b text-sm">
          {(["password", "dingtalk"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={
                "flex-1 border-b-2 px-3 py-2 transition-colors " +
                (tab === k
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground")
              }
            >
              {k === "password" ? "用户名密码" : "钉钉扫码"}
            </button>
          ))}
        </div>

        {tab === "password" && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "登录中..." : "登录"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              dev 默认账号：admin / admin123
            </p>
          </form>
        )}

        {tab === "dingtalk" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              点击下方按钮跳转钉钉同意授权页面，授权后会自动回到本系统。
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              onClick={handleDingtalk}
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "正在跳转..." : "前往钉钉登录"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              首次登录的钉钉用户会自动注册账号
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
