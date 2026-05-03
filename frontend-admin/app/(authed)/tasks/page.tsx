"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  taskApi,
  type TaskListItem,
  TASK_TYPE_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_RETRY_AVAILABLE,
  TASK_CANCEL_AVAILABLE,
  isTaskActive,
  relTime,
  durationOf,
} from "@/lib/api/task";
import { useTasks, useInvalidateTasks } from "@/lib/queries/tasks";
import {
  ErrorBanner,
  LoadingBlock,
  EmptyState,
} from "@/components/ui/StatusBlocks";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/context";

/**
 * 任务列表（W2-PUSH-06 + T9 增强）。
 * 过滤：type / status / storeId。
 * 自动刷新：当前页若有 PENDING / RUNNING 行，每 5s 重拉一次；全部终态后停止。
 * T9：FAILED 行加重试；parentTaskId=null 行可展开内嵌当前页内的子任务；toolbar 加 30s 自动刷新 toggle。
 */
const POLL_INTERVAL_MS = 5000;
const AUTO_REFRESH_MS = 30000;

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING: "warning",
  RUNNING: "info",
  SUCCESS: "success",
  FAILED: "error",
  PARTIAL: "warning",
  CANCELED: "neutral",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"}>{status}</Badge>
  );
}

export default function TasksPage() {
  const sp = useSearchParams();
  const toast = useToast();
  const { t } = useI18n();
  const initialType = sp.get("type") ?? "";
  const initialStatus = sp.get("status") ?? "";
  const initialStoreId = sp.get("storeId") ?? "";

  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [type, setType] = useState(initialType);
  const [status, setStatus] = useState(initialStatus);
  const [storeId, setStoreId] = useState(initialStoreId);
  const [appliedStoreId, setAppliedStoreId] = useState(initialStoreId);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [retrying, setRetrying] = useState<Record<number, boolean>>({});
  const [canceling, setCanceling] = useState<Record<number, boolean>>({});

  const storeIdNum = (() => {
    const t = appliedStoreId.trim();
    if (!t) return undefined;
    const n = Number(t);
    return isNaN(n) ? undefined : n;
  })();

  const queryParams = {
    page,
    size,
    type: type || undefined,
    status: status || undefined,
    storeId: storeIdNum,
  };

  // T9: 当前页若有活跃任务每 5s 轮询；用户开 30s 自动刷新时取较快者；都没有则关闭。
  const { data, isPending, error, refetch } = useTasks(queryParams);
  const records: TaskListItem[] = data?.records ?? [];
  const total = data?.total ?? 0;
  const hasActive = records.some((r) => isTaskActive(r.status));

  const refetchInterval = hasActive
    ? POLL_INTERVAL_MS
    : autoRefresh
      ? AUTO_REFRESH_MS
      : (false as const);

  // 第二次调用以应用动态 refetchInterval（同 queryKey 共享缓存）。
  useTasks(queryParams, { refetchInterval });

  const invalidateTasks = useInvalidateTasks();

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedStoreId(storeId);
  }

  function toggleExpand(id: number) {
    setExpanded((m) => ({ ...m, [id]: !m[id] }));
  }

  async function onRetry(id: number) {
    if (!TASK_RETRY_AVAILABLE) return;
    setRetrying((m) => ({ ...m, [id]: true }));
    try {
      await taskApi.retry(id);
      toast.success(`#${id} 已重试`);
      invalidateTasks();
    } catch (e) {
      toast.error(`重试失败：${(e as Error).message}`);
    } finally {
      setRetrying((m) => ({ ...m, [id]: false }));
    }
  }

  async function onCancel(id: number) {
    if (!TASK_CANCEL_AVAILABLE) return;
    if (!window.confirm(t("tasks.confirmCancel").replace("{id}", String(id)))) return;
    setCanceling((m) => ({ ...m, [id]: true }));
    try {
      await taskApi.cancel(id);
      toast.success(`#${id} 已取消`);
      invalidateTasks();
    } catch (e) {
      toast.error(`取消失败：${(e as Error).message}`);
    } finally {
      setCanceling((m) => ({ ...m, [id]: false }));
    }
  }

  function childrenOf(parentId: number): TaskListItem[] {
    return records.filter((r) => r.parentTaskId === parentId);
  }

  function hasChildrenInPage(id: number): boolean {
    return records.some((r) => r.parentTaskId === id);
  }

  const errorMsg = error ? (error as Error).message : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("tasks.title")}</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span>{t("tasks.autoRefresh")}</span>
          </label>
          <span>
            {hasActive ? `轮询中 · ${POLL_INTERVAL_MS / 1000}s` : "已停止轮询"}
          </span>
        </div>
      </div>

      <form onSubmit={search} className="flex flex-wrap gap-2 text-sm">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2"
        >
          {TASK_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2"
        >
          {TASK_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          placeholder="店铺 ID"
          className="w-32 rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          搜索
        </button>
      </form>

      <ErrorBanner message={errorMsg} onRetry={() => refetch()} />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="px-3 py-2 text-left">{t("tasks.column.id")}</th>
              <th className="px-3 py-2 text-left">{t("tasks.column.type")}</th>
              <th className="px-3 py-2 text-left">{t("tasks.column.status")}</th>
              <th className="px-3 py-2 text-left">{t("tasks.column.store")} ID</th>
              <th className="px-3 py-2 text-left">开始</th>
              <th className="px-3 py-2 text-left">完成</th>
              <th className="px-3 py-2 text-right">耗时</th>
              <th className="px-3 py-2 text-left">触发者</th>
              <th className="px-3 py-2 text-right">{t("tasks.column.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={10} className="px-3 py-2">
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!isPending && records.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-2">
                  <EmptyState
                    title={t("tasks.empty")}
                    hint="可在产品详情页点击「推送到店铺」创建一条 PRODUCT_PUSH 任务"
                  />
                </td>
              </tr>
            )}
            {records
              .filter((r) => r.parentTaskId == null)
              .map((r) => {
                const isOpen = !!expanded[r.id];
                const hasChild = hasChildrenInPage(r.id);
                const showExpand = r.parentTaskId == null && hasChild;
                return (
                  <TaskRow
                    key={r.id}
                    r={r}
                    childRow={false}
                    expanded={isOpen}
                    showExpand={showExpand}
                    onToggle={() => toggleExpand(r.id)}
                    onRetry={() => onRetry(r.id)}
                    retrying={!!retrying[r.id]}
                    onCancel={() => onCancel(r.id)}
                    canceling={!!canceling[r.id]}
                  >
                    {isOpen &&
                      childrenOf(r.id).map((c) => (
                        <TaskRow
                          key={c.id}
                          r={c}
                          childRow
                          expanded={false}
                          showExpand={false}
                          onToggle={() => {}}
                          onRetry={() => onRetry(c.id)}
                          retrying={!!retrying[c.id]}
                          onCancel={() => onCancel(c.id)}
                          canceling={!!canceling[c.id]}
                        />
                      ))}
                  </TaskRow>
                );
              })}
            {/* 孤儿子任务（parent 不在当前页）按普通行显示 */}
            {records
              .filter(
                (r) =>
                  r.parentTaskId != null &&
                  !records.some((p) => p.id === r.parentTaskId)
              )
              .map((r) => (
                <TaskRow
                  key={r.id}
                  r={r}
                  childRow={false}
                  expanded={false}
                  showExpand={false}
                  onToggle={() => {}}
                  onRetry={() => onRetry(r.id)}
                  retrying={!!retrying[r.id]}
                  onCancel={() => onCancel(r.id)}
                  canceling={!!canceling[r.id]}
                />
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            上一页
          </button>
          <span>
            第 {page} / {Math.max(1, Math.ceil(total / size))} 页
          </span>
          <button
            disabled={page * size >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskRow({
  r,
  childRow,
  expanded,
  showExpand,
  onToggle,
  onRetry,
  retrying,
  onCancel,
  canceling,
  children,
}: {
  r: TaskListItem;
  childRow: boolean;
  expanded: boolean;
  showExpand: boolean;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
  onCancel: () => void;
  canceling: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const failed = r.status === "FAILED";
  const cancelable = r.status === "PENDING" || r.status === "RUNNING";
  const retryDisabled = !TASK_RETRY_AVAILABLE || retrying;
  const cancelDisabled = !TASK_CANCEL_AVAILABLE || canceling;
  return (
    <>
      <tr
        className={
          "border-t hover:bg-muted/30 " +
          (childRow ? "bg-muted/20 text-xs" : "")
        }
      >
        <td className="px-2 py-2 text-center">
          {showExpand ? (
            <button
              type="button"
              onClick={onToggle}
              className="text-muted-foreground hover:text-foreground"
              aria-label={expanded ? t("tasks.action.collapse") : t("tasks.action.expand")}
            >
              {expanded ? "▼" : "▶"}
            </button>
          ) : childRow ? (
            <span className="text-muted-foreground">└</span>
          ) : null}
        </td>
        <td
          className={
            "px-3 py-2 font-mono text-xs " + (childRow ? "pl-8" : "")
          }
        >
          {r.id}
        </td>
        <td className="px-3 py-2">
          <span className="rounded border bg-muted px-2 py-0.5 text-xs">
            {r.type}
          </span>
        </td>
        <td className="px-3 py-2">
          <StatusBadge status={r.status} />
        </td>
        <td className="px-3 py-2 font-mono text-xs">{r.storeId ?? "-"}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {relTime(r.startedAt)}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {relTime(r.completedAt)}
        </td>
        <td className="px-3 py-2 text-right text-xs">{durationOf(r)}</td>
        <td className="px-3 py-2 text-xs">{r.triggeredBy ?? "-"}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1">
            {failed && (
              <button
                type="button"
                disabled={retryDisabled}
                onClick={onRetry}
                title={
                  TASK_RETRY_AVAILABLE
                    ? "重试该任务"
                    : "后端尚未实现 POST /task/{id}/retry"
                }
                className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retrying ? "重试中…" : t("tasks.action.retry")}
              </button>
            )}
            {cancelable && (
              <button
                type="button"
                disabled={cancelDisabled}
                onClick={onCancel}
                title="取消该任务"
                className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-900 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {canceling ? "取消中…" : t("tasks.action.cancel")}
              </button>
            )}
            <Link
              href={`/tasks/${r.id}`}
              className="rounded border px-2 py-1 text-xs hover:bg-accent"
            >
              查看
            </Link>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}
