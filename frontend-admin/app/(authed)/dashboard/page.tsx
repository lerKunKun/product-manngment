"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { relTime } from "@/lib/api/task";
import { notificationLogApi, type NotificationLog } from "@/lib/api/notificationLog";
import { useDashboardKpis, useFailedTasks } from "@/lib/queries/dashboard";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/StatusBlocks";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const { t } = useI18n();

  const { products, storesActive, tasksToday, approvalsPending } = useDashboardKpis();
  const failedTasks = useFailedTasks();

  const [notifLogs, setNotifLogs] = useState<NotificationLog[] | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      try {
        let r;
        try {
          r = await notificationLogApi.list({ from, size: 1000 });
        } catch {
          r = await notificationLogApi.list({ from, size: 500 });
        }
        if (alive) setNotifLogs(r.records ?? []);
      } catch {
        if (alive) setNotifLogs(null);
      } finally {
        if (alive) setNotifLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const cards = [
    { title: t("dashboard.totalProducts"), q: products, href: "/products" },
    { title: t("dashboard.activeStores"), q: storesActive, href: "/stores" },
    { title: t("dashboard.todayPushes"), q: tasksToday, href: "/tasks" },
    { title: t("dashboard.pendingApprovals"), q: approvalsPending, href: "/approvals" },
  ];

  const failed = failedTasks.data ?? [];
  const failedLoading = failedTasks.isPending;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">欢迎，{user?.username ?? ""}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <Card
            key={c.title}
            onClick={() => router.push(c.href)}
            className="cursor-pointer transition-shadow hover:shadow-md"
          >
            <CardHeader className="pb-2">
              <CardDescription>{c.title}</CardDescription>
            </CardHeader>
            <CardContent>
              {c.q.isPending ? (
                <Skeleton className="h-9 w-20" />
              ) : c.q.data === null || c.q.data === undefined ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="text-3xl font-semibold tabular-nums">{c.q.data}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("dashboard.notificationsLast24h")}</h2>
        </div>
        <div className="p-4">
          {notifLoading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : notifLogs === null || notifLogs.length === 0 ? (
            <EmptyState title="暂无通知数据" />
          ) : (
            <NotificationChart logs={notifLogs} />
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("dashboard.recentFailedTasks")}</h2>
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

const CHANNELS = [
  { key: "DINGTALK", label: "DINGTALK", color: "#3b82f6" },
  { key: "EMAIL", label: "EMAIL", color: "#10b981" },
  { key: "INAPP", label: "INAPP", color: "#a855f7" },
] as const;

function NotificationChart({ logs }: { logs: NotificationLog[] }) {
  // 24 小时窗口：以当前时刻为终点，回看 24h，按 createdAt 落在 [now-24h, now] 的小时桶
  const now = new Date();
  const buckets: Record<string, number[]> = {
    DINGTALK: new Array(24).fill(0),
    EMAIL: new Array(24).fill(0),
    INAPP: new Array(24).fill(0),
  };
  for (const l of logs) {
    if (!l.createdAt) continue;
    const t = new Date(l.createdAt).getTime();
    if (isNaN(t)) continue;
    const diffH = Math.floor((now.getTime() - t) / 3_600_000);
    if (diffH < 0 || diffH >= 24) continue;
    const idx = 23 - diffH; // 0 = 24h前, 23 = 当前小时
    const ch = (l.channel ?? "").toUpperCase();
    if (buckets[ch]) buckets[ch][idx] += 1;
  }
  const totals = {
    DINGTALK: buckets.DINGTALK.reduce((a, b) => a + b, 0),
    EMAIL: buckets.EMAIL.reduce((a, b) => a + b, 0),
    INAPP: buckets.INAPP.reduce((a, b) => a + b, 0),
  };
  const allMax = Math.max(
    1,
    ...buckets.DINGTALK,
    ...buckets.EMAIL,
    ...buckets.INAPP
  );
  const yMax = Math.ceil(allMax * 1.1);

  // SVG 坐标系：viewBox 720x240，左 padding 32（y label），底 padding 24（x label），右 padding 8，顶 padding 8
  const W = 720;
  const H = 240;
  const PL = 32;
  const PR = 8;
  const PT = 8;
  const PB = 24;
  const innerW = W - PL - PR; // 680
  const innerH = H - PT - PB; // 208
  const stepX = innerW / 23;

  function pointFor(arr: number[]): { x: number; y: number }[] {
    return arr.map((v, i) => ({
      x: PL + i * stepX,
      y: PT + innerH - (v / yMax) * innerH,
    }));
  }

  const xLabels = ["00", "03", "06", "09", "12", "15", "18", "21"];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {CHANNELS.map((c) => (
          <div key={c.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: c.color }}
            />
            <span className="font-medium">{c.label}</span>
            <span className="text-muted-foreground">
              {totals[c.key as keyof typeof totals]}
            </span>
          </div>
        ))}
        <span className="ml-auto text-muted-foreground">
          总计 {totals.DINGTALK + totals.EMAIL + totals.INAPP}
        </span>
      </div>
      <svg
        role="img"
        aria-label="24 小时通知发送趋势"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="240"
        preserveAspectRatio="none"
      >
        {/* y axis labels */}
        <text x={PL - 4} y={PT + 8} textAnchor="end" fontSize="10" fill="#71717a">
          {yMax}
        </text>
        <text
          x={PL - 4}
          y={PT + innerH}
          textAnchor="end"
          fontSize="10"
          fill="#71717a"
        >
          0
        </text>
        {/* baseline */}
        <line
          x1={PL}
          y1={PT + innerH}
          x2={PL + innerW}
          y2={PT + innerH}
          stroke="#e4e4e7"
          strokeWidth="1"
        />
        {/* x axis labels：每 3 小时一个标签 */}
        {xLabels.map((lab, i) => {
          const x = PL + i * 3 * stepX;
          return (
            <text
              key={lab}
              x={x}
              y={H - 6}
              textAnchor="middle"
              fontSize="10"
              fill="#71717a"
            >
              {lab}
            </text>
          );
        })}
        {/* lines */}
        {CHANNELS.map((c) => {
          const pts = pointFor(buckets[c.key]);
          const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
          return (
            <g key={c.key}>
              <polyline
                fill="none"
                stroke={c.color}
                strokeWidth="2"
                points={polyline}
              />
              {pts.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r="3"
                  fill={c.color}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
