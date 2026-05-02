"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { storeApi } from "@/lib/api/store";
import type { ApiError } from "@/lib/api/client";

type Mode = "oauth" | "custom_app";

export default function NewStorePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("oauth");
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [brandName, setBrandName] = useState("");
  const [tenantId, setTenantId] = useState<number>(1);
  const [isDevStore, setIsDevStore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const domain = shopDomain.trim().toLowerCase();
      if (!domain.endsWith(".myshopify.com")) {
        setError("请输入完整的 *.myshopify.com 域名");
        setBusy(false);
        return;
      }
      if (mode === "custom_app") {
        await storeApi.connectCustomApp({
          tenantId,
          myshopifyDomain: domain,
          brandName: brandName || undefined,
          accessToken,
          isDevStore,
        });
        router.push("/stores");
      } else {
        const r = await storeApi.initOAuth(domain, tenantId);
        window.location.href = r.authUrl;
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">接入店铺</h1>
      <p className="text-sm text-muted-foreground">
        选择接入方式：OAuth（推荐，适合新店）或 Custom App Token（粘贴永久 token，适合 Shopify Admin 后台手动建的应用）。
      </p>

      <div className="flex gap-2 text-sm">
        {(["oauth", "custom_app"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              "rounded-md border px-4 py-2 transition-colors " +
              (mode === m ? "border-primary bg-primary text-primary-foreground" : "")
            }
          >
            {m === "oauth" ? "Shopify OAuth（推荐）" : "Custom App Token"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-5 rounded-lg border bg-background p-5">
        <Field label="店铺域名（myshopify 后缀）">
          <input
            value={shopDomain}
            onChange={(e) => setShopDomain(e.target.value)}
            required
            placeholder="example.myshopify.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="所属分公司 ID">
          <input
            type="number"
            value={tenantId}
            onChange={(e) => setTenantId(Number(e.target.value))}
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>

        {mode === "custom_app" && (
          <>
            <Field label="品牌名（可选，未填取 Shopify shop.name）">
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Custom App Access Token (shpat_...)">
              <input
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                required
                type="password"
                placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Token 提交后会立即调 Shopify API 验证，通过后 AES-256-GCM 加密入库。
            </p>
          </>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDevStore}
            onChange={(e) => setIsDevStore(e.target.checked)}
          />
          这是 Partner dev store（用于详情页预览）
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy
              ? mode === "oauth"
                ? "正在跳转 Shopify..."
                : "验证 Token 中..."
              : mode === "oauth"
                ? "前往 Shopify 授权"
                : "保存并验证"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border px-5 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
