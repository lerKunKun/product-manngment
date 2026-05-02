"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/Tabs";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";
import {
  productSnapshotApi,
  type ProductSnapshot,
} from "@/lib/api/snapshot";
import {
  taskApi,
  type TaskListItem,
  type TaskDetail,
} from "@/lib/api/task";

const SNAP_VARIANT: Record<string, BadgeVariant> = {
  PENDING: "warning",
  RUNNING: "info",
  SUCCESS: "success",
  FAILED: "error",
};

const TASK_VARIANT: Record<string, BadgeVariant> = {
  PENDING: "warning",
  RUNNING: "info",
  SUCCESS: "success",
  FAILED: "error",
  PARTIAL: "warning",
  CANCELED: "neutral",
};

type TabKey = "snapshot" | "push";

type PushRow = TaskListItem & { productId?: number | null };

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleString("zh-CN") : "-";
}

export function ProductHistoryTabs({
  productId,
  initialTab = "snapshot",
}: {
  productId: number;
  initialTab?: TabKey;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);

  const [snapshots, setSnapshots] = useState<ProductSnapshot[] | null>(null);
  const [snapErr, setSnapErr] = useState("");
  const [pushes, setPushes] = useState<PushRow[] | null>(null);
  const [pushErr, setPushErr] = useState("");

  // 快照历史：list 不支持 productId filter，前端拉一页（size=50）后过滤
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSnapshots(null);
      setSnapErr("");
      try {
        const r = await productSnapshotApi.list(1, 50);
        if (cancelled) return;
        const filtered = (r?.records ?? []).filter(
          (s) => s.productId === productId
        );
        setSnapshots(filtered);
      } catch (e) {
        if (!cancelled) setSnapErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // 推送历史：list 也不带 productId，前端拉 size=100 + 并发取 detail 过滤 storeProduct.productId
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPushes(null);
      setPushErr("");
      try {
        const r = await taskApi.list(1, 100, { type: "PRODUCT_PUSH" });
        const items = r?.records ?? [];
        const details = await Promise.all(
          items.map((t) =>
            taskApi.detail(t.id).catch(() => null as TaskDetail | null)
          )
        );
        if (cancelled) return;
        const matched: PushRow[] = [];
        items.forEach((t, i) => {
          const d = details[i];
          const pid = d?.storeProduct?.productId ?? null;
          if (pid === productId) {
            matched.push({ ...t, productId: pid });
          }
        });
        setPushes(matched);
      } catch (e) {
        if (!cancelled) setPushErr((e as Error).message);
      }
    })();
  }, [productId]);

  const tabs = [
    { value: "snapshot", label: `快照历史${snapshots ? ` (${snapshots.length})` : ""}` },
    { value: "push", label: `推送历史${pushes ? ` (${pushes.length})` : ""}` },
  ];

  return (
    <div className="space-y-3">
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            currentValue={tab}
            onSelect={() => setTab(t.value as TabKey)}
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="snapshot" currentValue={tab}>
        {snapErr ? (
          <p className="text-sm text-destructive">{snapErr}</p>
        ) : snapshots === null ? (
          <LoadingBlock />
        ) : snapshots.length === 0 ? (
          <EmptyState
            title="暂无快照"
            hint="点击右上角「立即快照」手动触发"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">店铺</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">触发</th>
                  <th className="px-3 py-2 text-left">创建时间</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{s.id}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.storeId}</td>
                    <td className="px-3 py-2">
                      <Badge variant={SNAP_VARIANT[s.status] ?? "neutral"}>
                        {s.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">{s.triggerEvent}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {fmt(s.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/snapshots/${s.id}`}
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        详情
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="push" currentValue={tab}>
        {pushErr ? (
          <p className="text-sm text-destructive">{pushErr}</p>
        ) : pushes === null ? (
          <LoadingBlock />
        ) : pushes.length === 0 ? (
          <EmptyState
            title="暂无推送记录"
            hint="点击右上角「推送到店铺」触发"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Task ID</th>
                  <th className="px-3 py-2 text-left">店铺</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">创建时间</th>
                  <th className="px-3 py-2 text-left">错误</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {pushes.map((t) => (
                  <tr key={t.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{t.id}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {t.storeId ?? "-"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={TASK_VARIANT[t.status] ?? "neutral"}>
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {fmt(t.createdAt)}
                    </td>
                    <td
                      className="max-w-[260px] truncate px-3 py-2 text-xs text-muted-foreground"
                      title={t.errorMessage ?? ""}
                    >
                      {t.errorMessage ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/tasks/${t.id}`}
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        详情
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabsContent>
    </div>
  );
}
