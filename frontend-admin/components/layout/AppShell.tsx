"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { authApi } from "@/lib/api/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "首页" },
  { href: "/invitations", label: "临时员工邀请" },
  { href: "/stores", label: "店铺管理" },
  { href: "/partner-stores", label: "合作者店铺池" },
  { href: "/products", label: "产品库" },
  { href: "/assets", label: "资产快照" },
  { href: "/snapshots", label: "产品快照" },
  { href: "/tasks", label: "任务" },
  { href: "/approvals", label: "审批中心" },
  { href: "/inbox", label: "通知中心" },
  { href: "/recyclebin", label: "回收站" },
  { href: "/profile", label: "个人中心" },
  { href: "/cross-auth", label: "跨公司授权" },
  { href: "/templates", label: "模板库" },
  { href: "/guides", label: "指导文档" },
  { href: "/newstore", label: "一键开店" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    clear();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-muted/30 px-3 py-4">
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold">Biou × Shopify Hub</div>
          <div className="text-xs text-muted-foreground">v0.1.0-alpha</div>
        </div>
        <nav className="space-y-0.5">
          {NAV.map((it) => {
            const active = pathname === it.href || pathname.startsWith(it.href + "/");
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                )}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b bg-background px-6">
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="font-medium text-foreground">
                {user?.username ?? "—"}
              </div>
              <div className="text-muted-foreground">
                {user?.userType === "TEMP" ? "临时账号" : user?.employeeNo}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent"
            >
              退出登录
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
