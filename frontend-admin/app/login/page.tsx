"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authApi } from "@/lib/api/auth";
import { useAuthStore } from "@/lib/auth/store";
import type { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          加载中...
        </main>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useI18n();
  const setSession = useAuthStore((s) => s.setSession);

  const fromInvite = params.get("from") === "invite";
  const prefillEmail = params.get("email") ?? "";

  const [tab, setTab] = useState<"password" | "dingtalk">("password");
  const [username, setUsername] = useState(prefillEmail || "admin");
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
          roles: r.roles ?? [],
          permissions: r.permissions ?? [],
        },
        r.accessToken
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
        <h1 className="mb-1 text-xl font-semibold">{t("login.title")}</h1>
        <p className="mb-6 text-xs text-muted-foreground">
          Biou × Shopify Control Center
        </p>

        {fromInvite && (
          <div className="mb-5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            邀请已接受，请用邮箱 + 邮件中的临时密码登录。
          </div>
        )}

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
              {k === "password" ? t("login.passwordTab") : t("login.dingtalkScan")}
            </button>
          ))}
        </div>

        {tab === "password" && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("login.username")}</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder={t("login.username")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("login.password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                placeholder={t("login.password")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? t("login.submitting") : t("login.submit")}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              {t("login.devHint")}
            </p>
          </form>
        )}

        {tab === "dingtalk" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("login.dingtalkTip")}
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              onClick={handleDingtalk}
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? t("login.dingtalkRedirecting") : t("login.dingtalkSubmit")}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              {t("login.dingtalkRegisterHint")}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
