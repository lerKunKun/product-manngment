"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { invitationApi, type InvitationPreview } from "@/lib/api/invitation";
import { ApiError } from "@/lib/api/client";

type Phase = "loading" | "ready" | "submitting" | "success" | "error";

export default function InvitationAcceptPage() {
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

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string>("");
  const [tempPassword, setTempPassword] = useState("");

  useEffect(() => {
    if (!token) {
      setPhase("error");
      setError("链接无效：缺少 token 参数");
      return;
    }
    invitationApi
      .preview(token)
      .then((data) => {
        setPreview(data);
        setPhase("ready");
      })
      .catch((e: ApiError) => {
        setPhase("error");
        setError(e.message);
      });
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!tempPassword) return;
    setPhase("submitting");
    try {
      await invitationApi.accept(token, tempPassword);
      setPhase("success");
      // TODO: W1-AUTH 完成后改成跳"修改密码"页 + 携带 JWT
      setTimeout(() => router.push("/"), 2000);
    } catch (e) {
      setPhase("ready");
      setError((e as ApiError).message);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">接受邀请</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Biou × Shopify Control Center
        </p>

        {phase === "loading" && (
          <p className="text-sm text-muted-foreground">加载邀请信息...</p>
        )}

        {phase === "error" && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {(phase === "ready" || phase === "submitting") && preview && (
          <form onSubmit={handleAccept} className="space-y-5">
            <dl className="space-y-3 rounded-md border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">邮箱</dt>
                <dd className="font-medium">{preview.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">所属公司</dt>
                <dd className="font-medium">{preview.companyName}</dd>
              </div>
              {preview.deptName && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">所属部门</dt>
                  <dd className="font-medium">{preview.deptName}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">角色</dt>
                <dd className="font-medium">{preview.roleNames.join("、")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">账号有效期至</dt>
                <dd className="font-medium text-destructive">
                  {new Date(preview.accountExpiresAt).toLocaleString("zh-CN")}
                </dd>
              </div>
            </dl>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                邮件中的临时密码
              </label>
              <input
                type="password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                required
                autoFocus
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="粘贴邮件中的临时密码"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={phase === "submitting" || !tempPassword}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {phase === "submitting" ? "接受中..." : "接受邀请并登录"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              首次登录后请到"个人中心 → 修改密码"修改临时密码。
            </p>
          </form>
        )}

        {phase === "success" && (
          <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 p-6 text-center">
            <p className="text-sm font-medium text-emerald-900">
              ✓ 邀请已接受
            </p>
            <p className="text-xs text-emerald-700">即将跳转...</p>
          </div>
        )}
      </div>
    </main>
  );
}
