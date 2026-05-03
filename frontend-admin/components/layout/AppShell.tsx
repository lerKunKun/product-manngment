"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/auth/store";
import { authApi } from "@/lib/api/auth";
import { useUnreadInboxCount } from "@/lib/queries/inbox";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { Sheet, SheetHeader, SheetTitle, SheetContent } from "@/components/ui/Sheet";

type NavGroup = {
  section: string | null;
  items: { href: string; label: string }[];
};

function getNavGroups(t: (k: MessageKey) => string): NavGroup[] {
  return [
    { section: null, items: [{ href: "/dashboard", label: t("nav.home") }] },
    {
      section: t("nav.business"),
      items: [
        { href: "/products", label: t("nav.products") },
        { href: "/stores", label: t("nav.stores") },
        { href: "/partner-stores", label: t("nav.partner-stores") },
        { href: "/newstore", label: t("nav.newstore") },
      ],
    },
    {
      section: t("nav.assets"),
      items: [
        { href: "/assets", label: t("nav.assets-snapshot") },
        { href: "/snapshots", label: t("nav.snapshots") },
        { href: "/templates", label: t("nav.templates") },
      ],
    },
    {
      section: t("nav.flow"),
      items: [
        { href: "/approvals", label: t("nav.approvals") },
        { href: "/invitations", label: t("nav.invitations") },
        { href: "/cross-auth", label: t("nav.cross-auth") },
      ],
    },
    {
      section: t("nav.my"),
      items: [
        { href: "/inbox", label: t("nav.inbox") },
        { href: "/profile", label: t("nav.profile") },
      ],
    },
    {
      section: t("nav.tools"),
      items: [
        { href: "/tasks", label: t("nav.tasks") },
        { href: "/recyclebin", label: t("nav.recyclebin") },
        { href: "/guides", label: t("nav.guides") },
      ],
    },
    {
      section: t("nav.system"),
      items: [
        { href: "/orgs", label: t("nav.orgs") },
        { href: "/admin/users", label: t("nav.users") },
        { href: "/admin/role", label: t("nav.role") },
        // TODO i18n: G2 新增「角色画布」入口（不动 lib/i18n/messages.ts）
        { href: "/admin/canvas", label: "角色画布" },
        { href: "/admin/datasources", label: t("nav.datasources") },
        { href: "/admin/notification-log", label: t("nav.notification-log") },
        { href: "/admin/audit-log", label: t("nav.audit-log") },
        { href: "/admin/ops", label: t("nav.ops") },
      ],
    },
  ];
}

function NavList({
  pathname,
  navGroups,
  onLinkClick,
}: {
  pathname: string;
  navGroups: NavGroup[];
  onLinkClick?: () => void;
}) {
  return (
    <nav className="space-y-4">
      {navGroups.map((g, gi) => (
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
                onClick={onLinkClick}
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
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const impersonation = useAuthStore((s) => s.impersonation);
  const endImpersonation = useAuthStore((s) => s.endImpersonation);
  const { data: unreadResp } = useUnreadInboxCount();
  const unread = unreadResp?.count ?? 0;
  const { locale, setLocale, t } = useI18n();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navGroups = getNavGroups(t);

  useEffect(() => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light"
    );
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

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
      <aside className="hidden w-56 shrink-0 border-r bg-muted/30 px-3 py-4 md:flex md:flex-col">
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold">Biou × Shopify Hub</div>
          <div className="text-xs text-muted-foreground">v0.1.0-alpha</div>
        </div>
        <NavList pathname={pathname} navGroups={navGroups} />
      </aside>
      <Sheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        side="left"
      >
        <SheetHeader>
          <SheetTitle>Biou × Shopify Hub</SheetTitle>
        </SheetHeader>
        <SheetContent>
          <NavList
            pathname={pathname}
            navGroups={navGroups}
            onLinkClick={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>
      <div className="flex flex-1 flex-col">
        {impersonation.impersonating && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-xs text-amber-900 md:px-6">
            <div>
              <span className="mr-2 inline-flex items-center rounded-md bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Impersonate
              </span>
              当前以 <strong className="mx-1">{impersonation.targetUsername ?? "—"}</strong>
              身份登录中（短期会话；到期需重新登录）。
            </div>
            <button
              type="button"
              onClick={() => {
                const ok = endImpersonation();
                if (ok) {
                  router.push("/dashboard");
                } else {
                  // 兜底：内存丢失原 token；让用户重新登录
                  router.push("/login");
                }
              }}
              className="rounded-md border border-amber-600 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50"
            >
              返回原身份
            </button>
          </div>
        )}
        <header className="flex h-14 items-center justify-between border-b bg-background px-4 md:justify-end md:px-6">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-md border p-1.5 text-sm hover:bg-accent md:hidden"
            aria-label="菜单"
          >
            ☰
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="切换主题"
              className="rounded-md border bg-background p-1.5 text-sm hover:bg-accent"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <button
              type="button"
              onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
              className="rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent"
              aria-label="切换语言 / Switch language"
            >
              {locale === "zh-CN" ? "EN" : "中"}
            </button>
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
