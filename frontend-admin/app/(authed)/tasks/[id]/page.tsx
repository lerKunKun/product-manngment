"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  taskApi,
  type TaskDetail,
  type TaskPayloadResp,
  TASK_STATUS_BADGE,
  isTaskActive,
  durationOf,
} from "@/lib/api/task";
import {
  LoadingBlock,
  ErrorBanner,
  EmptyState,
} from "@/components/ui/StatusBlocks";

type Tab = "detail" | "payload" | "result" | "conflicts";

const POLL_INTERVAL_MS = 3000;

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [d, setD] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("detail");

  // payload / result lazy-load
  const [payloadResp, setPayloadResp] = useState<TaskPayloadResp | null>(null);
  const [payloadLoaded, setPayloadLoaded] = useState(false);
  const [payloadLoading, setPayloadLoading] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const r = await taskApi.detail(id);
        setD(r);
      } catch (e) {
        if (!silent) setError((e as Error).message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id]
  );

  const loadPayload = useCallback(async () => {
    if (payloadLoading) return;
    setPayloadLoading(true);
    try {
      const r = await taskApi.payload(id);
      setPayloadResp(r);
      setPayloadLoaded(true);
    } catch {
      // toast 已上报
    } finally {
      setPayloadLoading(false);
    }
  }, [id, payloadLoading]);

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 轮询：仅在状态为 PENDING / RUNNING 时启动
  const active = !!d && d.status && isTaskActive(d.status);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => {
      load(true);
      // 任务跑着时 payload / result 也会变化（result 在结束时才落库），刷新一下
      if (payloadLoaded) {
        taskApi
          .payload(id)
          .then((r) => setPayloadResp(r))
          .catch(() => {});
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, payloadLoaded, id]);

  // 切到 payload / result tab 时按需加载
  useEffect(() => {
    if ((tab === "payload" || tab === "result") && !payloadLoaded) {
      loadPayload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={() => load()} />;
  if (!d || !d.id) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/tasks")}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← 返回列表
          </button>
        </div>
        <EmptyState title="任务不存在" hint={`id=${id} 未找到`} />
      </div>
    );
  }

  const cls =
    TASK_STATUS_BADGE[d.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";
  const conflictsCount = d.pushConflicts?.length ?? 0;
  const tabs: { k: Tab; label: string }[] = [
    { k: "detail", label: "详情" },
    { k: "payload", label: "Payload" },
    { k: "result", label: "Result" },
    { k: "conflicts", label: `冲突 (${conflictsCount})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/tasks")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回列表
        </button>
        <h1 className="text-2xl font-semibold">任务 #{d.id}</h1>
        <span className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}>
          {d.status}
        </span>
        <span className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
          {d.type}
        </span>
        <span className="flex-1" />
        {active && (
          <span className="text-xs text-muted-foreground">
            轮询中 · {POLL_INTERVAL_MS / 1000}s
          </span>
        )}
      </div>

      {d.status === "FAILED" && d.errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-medium">失败原因</div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
            {d.errorMessage}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b text-sm">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={
              "border-b-2 px-3 py-2 transition-colors " +
              (tab === t.k
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "detail" && (
        <section className="rounded-lg border bg-background p-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
            <Field label="ID" value={d.id} />
            <Field label="租户 ID" value={d.tenantId ?? "-"} />
            <Field label="店铺 ID" value={d.storeId ?? "-"} />
            <Field label="类型" value={d.type} />
            <Field label="状态" value={d.status} />
            <Field label="触发者" value={d.triggeredBy ?? "-"} />
            <Field label="父任务" value={d.parentTaskId ?? "-"} />
            <Field
              label="创建时间"
              value={d.createdAt ? new Date(d.createdAt).toLocaleString("zh-CN") : "-"}
            />
            <Field
              label="开始时间"
              value={d.startedAt ? new Date(d.startedAt).toLocaleString("zh-CN") : "-"}
            />
            <Field
              label="完成时间"
              value={d.completedAt ? new Date(d.completedAt).toLocaleString("zh-CN") : "-"}
            />
            <Field label="耗时" value={durationOf(d)} />
          </dl>

          {d.storeProduct && (
            <div className="mt-4 rounded border bg-muted/20 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                关联 store_product
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-3">
                <Field label="store_product.id" value={d.storeProduct.id} mono />
                <Field label="store_id" value={d.storeProduct.storeId} mono />
                <Field label="product_id" value={d.storeProduct.productId} mono />
                <Field
                  label="shopify_product_id"
                  value={d.storeProduct.shopifyProductId ?? "-"}
                  mono
                />
                <Field
                  label="shopify_handle"
                  value={d.storeProduct.shopifyHandle ?? "-"}
                  mono
                />
                <Field label="status" value={d.storeProduct.status ?? "-"} />
              </dl>
            </div>
          )}
        </section>
      )}

      {tab === "payload" && (
        <section className="rounded-lg border bg-background p-4 text-sm">
          {payloadLoading && <LoadingBlock />}
          {!payloadLoading && !payloadLoaded && (
            <button
              onClick={loadPayload}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              加载 Payload
            </button>
          )}
          {!payloadLoading && payloadLoaded && payloadResp?.payload != null && (
            <pre className="max-h-[640px] overflow-auto rounded border bg-muted/30 p-3 font-mono text-xs">
              {JSON.stringify(payloadResp.payload, null, 2)}
            </pre>
          )}
          {!payloadLoading && payloadLoaded && payloadResp?.payload == null && (
            <EmptyState title="payload 为空或无法解析" />
          )}
        </section>
      )}

      {tab === "result" && (
        <section className="rounded-lg border bg-background p-4 text-sm">
          {payloadLoading && <LoadingBlock />}
          {!payloadLoading && !payloadLoaded && (
            <button
              onClick={loadPayload}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              加载 Result
            </button>
          )}
          {!payloadLoading && payloadLoaded && payloadResp?.result != null && (
            <pre className="max-h-[640px] overflow-auto rounded border bg-muted/30 p-3 font-mono text-xs">
              {JSON.stringify(payloadResp.result, null, 2)}
            </pre>
          )}
          {!payloadLoading && payloadLoaded && payloadResp?.result == null && (
            <EmptyState
              title="result 为空"
              hint={
                isTaskActive(d.status)
                  ? "任务还在跑，result 在结束时才会落库"
                  : undefined
              }
            />
          )}
        </section>
      )}

      {tab === "conflicts" && (
        <section className="rounded-lg border bg-background p-4 text-sm">
          {conflictsCount === 0 ? (
            <EmptyState title="暂无冲突" />
          ) : (
            <div className="overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">ID</th>
                    <th className="px-2 py-1.5 text-left">类型</th>
                    <th className="px-2 py-1.5 text-left">状态</th>
                    <th className="px-2 py-1.5 text-left">store_id</th>
                    <th className="px-2 py-1.5 text-left">product_id</th>
                    <th className="px-2 py-1.5 text-left">详情</th>
                    <th className="px-2 py-1.5 text-left">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {d.pushConflicts!.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-2 py-1.5 font-mono text-xs">{c.id}</td>
                      <td className="px-2 py-1.5">
                        <span className="rounded border bg-muted px-1.5 py-0.5 text-xs">
                          {c.conflictType}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs">{c.status}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{c.storeId}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{c.productId}</td>
                      <td className="px-2 py-1.5">
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            查看
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded border bg-muted/30 p-2 font-mono text-[10px]">
                            {c.detailJson || "-"}
                          </pre>
                        </details>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {c.createdAt
                          ? new Date(c.createdAt).toLocaleString("zh-CN")
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            冲突解决（resolve / overwrite / rename）将在 W3 接入；当前只读展示。
          </p>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</dd>
    </div>
  );
}
