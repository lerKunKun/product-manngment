"use client";

/**
 * 页面级权限守卫（P4）。
 *
 * 用法：在敏感页面 page.tsx 顶层包裹：
 * ```tsx
 * <PageGuard anyPerm={["USER:READ", "USER:MANAGE"]} fallback="/dashboard">
 *   <AdminUsersPage />
 * </PageGuard>
 * ```
 *
 * 行为：
 *  - 等 zustand hydrate 完 + permissions 拉到（避免 SSR/boot 期间误拒）
 *  - 缺权限 → 弹 toast + router.replace(fallback)
 *  - 命中权限 → 渲染 children
 *
 * **重要**：这只是 UX 护栏，不替代后端 @PreAuthorize。任何用户都能改 zustand
 * 绕过前端检查，但绕了也调不通后端接口（拿 403）。
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { useAuth } from "@/lib/auth/permissions";
import { toast } from "@/components/ui/Toast";

export function PageGuard({
  anyPerm,
  fallback = "/dashboard",
  children,
}: {
  /** 任一权限码命中即允许访问（OR 语义）。空数组或不传 = 无限制（仅要求登录）。 */
  anyPerm?: string[];
  /** 缺权限时跳转的路由，默认 /dashboard。 */
  fallback?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const { permissions } = useAuth();
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    // 不要求权限：直接通过
    if (!anyPerm || anyPerm.length === 0) {
      setDecided(true);
      return;
    }
    // permissions 还没拉到（heartbeat 在跑）：再等一帧
    // 但如果 hydrated 完成而 permissions 仍空，说明真的没权限
    const ok = anyPerm.some((c) => permissions.includes(c));
    if (ok) {
      setDecided(true);
    } else {
      toast.error("无权访问该页面", 4000);
      router.replace(fallback);
    }
  }, [hydrated, permissions, anyPerm, fallback, router]);

  if (!decided) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        正在校验权限…
      </div>
    );
  }
  return <>{children}</>;
}
