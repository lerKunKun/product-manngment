"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { productApi } from "@/lib/api/product";
import { storeApi } from "@/lib/api/store";
import { taskApi, type TaskListItem, relTime } from "@/lib/api/task";
import { approvalApi } from "@/lib/api/approval";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";

type CardData = { value: number | null; loading: boolean };

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  const [products, setProducts] = useState<CardData>({ value: null, loading: true });
  const [stores, setStores] = useState<CardData>({ value: null, loading: true });
  const [pushTasks, setPushTasks] = useState<CardData>({ value: null, loading: true });
  const [approvals, setApprovals] = useState<CardData>({ value: null, loading: true });
  const [failed, setFailed] = useState<TaskListItem[]>([]);
  const [failedLoading, setFailedLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await productApi.list(1, 1);
        if (alive) setProducts({ value: r.total ?? 0, loading: false });
      } catch {
        if (alive) setProducts({ value: null, loading: false });
      }
    })();
    (async () => {
      try {
        const r = await storeApi.list();
        const arr = Array.isArray(r) ? r : [];
        const active = arr.filter((s) => s.status === "ACTIVE").length;
        if (alive) setStores({ value: active, loading: false });
      } catch {
        if (alive) setStores({ value: null, loading: false });
      }
    })();
    (async () => {
      try {
        const r = await taskApi.list(1, 100, { type: "PRODUCT_PUSH" });
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const cutoff = startOfDay.getTime();
        const today = (r.records ?? []).filter((t) => {
          if (!t.createdAt) return false;
          const ts = new Date(t.createdAt).getTime();
          return !isNaN(ts) && ts >= cutoff;
        }).length;
        if (alive) setPushTasks({ value: today, loading: false });
      } catch {
        if (alive) setPushTasks({ value: null, loading: false });
      }
    })();
    (async () => {
      try {
        const r = await approvalApi.myPending();
        if (alive) setApprovals({ value: (r ?? []).length, loading: false });
      } catch {
        if (alive) setApprovals({ value: null, loading: false });
      }
    })();
    (async () => {
      try {
        const r = await taskApi.list(1, 5, { status: "FAILED" });
        if (alive) setFailed(r.records ?? []);
      } catch {
        /* ignore */
      } finally {
        if (alive) setFailedLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const cards = [
    { title: "产品总数", data: products, href: "/products" },
    { title: "在线店铺数", data: stores, href: "/stores" },
    { title: "今日推送任务", data: pushTasks, href: "/tasks" },
    { title: "待办审批", data: approvals, href: "/approvals" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">欢迎，{user?.username ?? ""}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.title}
            type="button"
            onClick={() => router.push(c.href)}
            className="rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent/40"
          >
            <div className="text-xs text-muted-foreground">{c.title}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">
              {c.data.loading ? (
                <Skeleton className="h-8 w-16" />
              ) : c.data.value === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                c.data.value
              )}
            </div>
          </button>
        ))}
      </div>

      <section className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">最近 5 个失败任务</h2>
          <Link
            href="/tasks?status=FAILED"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            查看全部 →
          </Link>
        </div>
        {failedLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : failed.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            暂无失败任务
          </div>
        ) : (
          <ul className="divide-y">
            {failed.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  #{t.id}
                </span>
                <Badge variant="error">FAILED</Badge>
                <span className="font-medium">{t.type}</span>
                <span className="text-xs text-muted-foreground">
                  {relTime(t.createdAt)}
                </span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {t.errorMessage ?? "-"}
                </span>
                <Link
                  href={`/tasks/${t.id}`}
                  className="shrink-0 text-xs text-primary hover:underline"
                >
                  详情
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
