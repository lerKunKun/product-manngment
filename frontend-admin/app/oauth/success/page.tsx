"use client";

/**
 * Shopify OAuth 授权成功页（公开路由，故意不放 (authed) 下面）。
 *
 * 为什么独立成页而不是 toast：
 * 用户从 Shopify 跳回时 SPA 内存里的 accessToken 丢了，(authed)/layout.tsx 必须先走
 * 一次 /auth/refresh 才会渲染子路由，这期间整页是 "正在恢复登录状态..." 白底——
 * toast 来不及出。把成功页放在 (authed) 外面，即时渲染 3s 倒计时再跳目标页，
 * 用户感知到的就是清晰的成功反馈而不是白屏。
 *
 * 兼容两条 OAuth 链路：
 *   - 标准接入 (ShopifyOAuthController)：?shop=xxx           → 倒计时后回 /stores
 *   - 一键开店 (SagaOAuthCallbackController)：?shop=xxx&taskId=N → 倒计时后回 /newstore/N
 *
 * Next 15 prod build 要求：useSearchParams 必须裹在 Suspense 边界，否则 prerender 报错。
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const COUNTDOWN_SECONDS = 3;

function SuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const shop = searchParams.get("shop") ?? "";
  const taskId = searchParams.get("taskId") ?? "";
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS);

  const destination = taskId ? `/newstore/${taskId}` : "/stores";
  const destinationLabel = taskId ? "Saga 进度页" : "店铺管理";

  // 直接访问无 shop param：当成误入，跳回 /stores
  useEffect(() => {
    if (!shop) {
      router.replace("/stores");
    }
  }, [shop, router]);

  useEffect(() => {
    if (!shop) return;
    if (seconds <= 0) {
      router.replace(destination);
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, shop, destination, router]);

  if (!shop) return null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg border bg-background p-8 text-center shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-9 w-9"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold">店铺授权成功</h1>
        <p className="font-mono text-sm text-muted-foreground break-all">{shop}</p>
        <p className="text-xs text-muted-foreground">
          {seconds} 秒后自动返回{destinationLabel}…
        </p>
        <button
          type="button"
          onClick={() => router.replace(destination)}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          立即返回
        </button>
      </div>
    </div>
  );
}

export default function OAuthSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      }
    >
      <SuccessInner />
    </Suspense>
  );
}
