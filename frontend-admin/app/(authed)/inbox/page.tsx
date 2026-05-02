"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, EmptyState, ErrorBanner } from "@/components/ui/StatusBlocks";
import { inboxApi, type InappMessage } from "@/lib/api/inbox";
import type { ApiError } from "@/lib/api/client";

const PAGE_SIZE = 20;

export default function InboxPage() {
  const toast = useToast();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<InappMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, cnt] = await Promise.all([
        inboxApi.list({ unreadOnly: tab === "unread", page, size: PAGE_SIZE }),
        inboxApi.unreadCount(),
      ]);
      setItems(list.items ?? []);
      setTotal(list.total ?? 0);
      setUnread(cnt.count ?? 0);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleExpand(m: InappMessage) {
    if (expanded === m.id) {
      setExpanded(null);
      return;
    }
    setExpanded(m.id);
    if (!m.readAt) {
      try {
        await inboxApi.markRead(m.id);
        setItems((prev) =>
          prev.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x))
        );
        setUnread((c) => Math.max(0, c - 1));
      } catch {
        /* toast 已由 client 报 */
      }
    }
  }

  async function handleMarkAllRead() {
    try {
      const r = await inboxApi.markAllRead();
      toast.success(`已标记 ${r.updated} 条为已读`);
      load();
    } catch {
      /* */
    }
  }

  function followLink(url?: string) {
    if (!url) return;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = url;
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">通知中心</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            站内信收件箱。系统事件 / 钉钉同步 / 跨公司授权等通知会落到这里。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900">
            未读 {unread}
          </span>
          <button
            onClick={handleMarkAllRead}
            disabled={unread === 0}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            全部标已读
          </button>
        </div>
      </div>

      <div className="flex items-end justify-between rounded-lg border bg-background p-3">
        <div className="flex gap-1 text-sm">
          {(["all", "unread"] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setPage(1);
              }}
              className={
                "rounded-md border px-3 py-1.5 transition-colors " +
                (tab === k ? "border-primary bg-primary text-primary-foreground" : "")
              }
            >
              {k === "all" ? "全部" : "未读"}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">共 {total} 条</div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <div className="space-y-2">
        {loading && <LoadingBlock />}
        {!loading && items.length === 0 && (
          <EmptyState title="暂无通知" hint={tab === "unread" ? "全部已读" : "等待系统事件"} />
        )}
        {!loading &&
          items.map((m) => {
            const isUnread = !m.readAt;
            const isExpanded = expanded === m.id;
            return (
              <div
                key={m.id}
                className={
                  "rounded-md border transition-colors " +
                  (isUnread ? "border-primary/40 bg-primary/5" : "bg-background")
                }
              >
                <button
                  onClick={() => handleExpand(m)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/40"
                >
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                       style={{ background: isUnread ? "#dc2626" : "transparent",
                                border: isUnread ? "none" : "1px solid #d4d4d8" }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          "truncate text-sm " +
                          (isUnread ? "font-semibold text-foreground" : "text-muted-foreground")
                        }
                      >
                        {m.subject}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                        {m.eventCode}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t bg-background px-4 py-3 text-sm">
                    {m.bodyHtml ? (
                      <div
                        className="prose prose-sm max-w-none text-foreground"
                        // 注意：bodyHtml 来源于后端 EmailTemplateRenderer 等可控渲染，未引入富文本编辑器
                        dangerouslySetInnerHTML={{ __html: m.bodyHtml }}
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground">
                        {m.bodyText ?? ""}
                      </pre>
                    )}
                    {m.linkUrl && (
                      <div className="mt-3">
                        <button
                          onClick={() => followLink(m.linkUrl)}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          查看详情 →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
