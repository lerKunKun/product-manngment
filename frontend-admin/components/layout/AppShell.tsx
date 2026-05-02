"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/auth/store";
import { authApi } from "@/lib/api/auth";
import { inboxApi } from "@/lib/api/inbox";
import { cn } from "@/lib/utils";

const NAV_GROUPS: {
  section: string | null;
  items: { href: string; label: string }[];
}[] = [
  { section: null, items: [{ href: "/dashboard", label: "首页" }] },
  {
    section: "业务",
    items: [
      { href: "/products", label: "产品库" },
      { href: "/stores", label: "店铺管理" },
      { href: "/partner-stores", label: "合作者店铺池" },
      { href: "/newstore", label: "一键开店" },
    ],
  },
  {
    section: "资产",
    items: [
      { href: "/assets", label: "资产快照" },
      { href: "/snapshots", label: "产品快照" },
      { href: "/templates", label: "模板库" },
    ],
  },
  {
    section: "流程",
    items: [
      { href: "/approvals", label: "审批中心" },
      { href: "/invitations", label: "临时员工邀请" },
      { href: "/cross-auth", label: "跨公司授权" },
    ],
  },
  {
    section: "我的",
    items: [
      { href: "/inbox", label: "通知中心" },
      { href: "/profile", label: "个人中心" },
    ],
  },
  {
    section: "工具",
    items: [
      { href: "/tasks", label: "任务监控" },
      { href: "/recyclebin", label: "回收站" },
      { href: "/guides", label: "指导文档" },
    ],
  },
  {
    section: "系统",
    items: [
      { href: "/orgs", label: "组织管理" },
      { href: "/admin/role", label: "角色管理" },
      { href: "/admin/notification-log", label: "通知日志" },
      { href: "/admin/audit-log", label: "审计日志" },
      { href: "/admin/ops", label: "备份归档" },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await inboxApi.unreadCount();
        if (alive) setUnread(r?.count ?? 0);
      } catch {
        /* ignore */
      }
    }
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

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
        <nav className="space-y-4">
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi} className="space-y-0.5">
              {g.section && (
                <div className="px-3 pb-1 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                  {g.section}
                </div>
              )}
              {g.items.map((it) => {
                const active =
                  pathname === it.href || pathname.startsWith(it.href + "/");
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
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b bg-background px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="通知中心"
              onClick={() => router.push("/inbox")}
              className="relative rounded-md border bg-background p-1.5 text-sm hover:bg-accent"
            >
              <span aria-hidden>🔔</span>
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-4 text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
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
