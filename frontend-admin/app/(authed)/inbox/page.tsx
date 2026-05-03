"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, EmptyState, ErrorBanner } from "@/components/ui/StatusBlocks";
import { inboxApi, type InappMessage } from "@/lib/api/inbox";
import type { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";

const PAGE_SIZE = 20;

const CATEGORIES = ["all", "invitation", "store", "push", "approval", "ops", "system"] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABEL_KEY: Record<Category, MessageKey> = {
  all: "inbox.category.all",
  invitation: "inbox.category.invitation",
  store: "inbox.category.store",
  push: "inbox.category.push",
  approval: "inbox.category.approval",
  ops: "inbox.category.ops",
  system: "inbox.category.system",
};

function categoryOf(eventCode: string): Exclude<Category, "all"> {
  if (eventCode.startsWith("INVITATION_")) return "invitation";
  if (eventCode.includes("NEW_STORE") || eventCode.includes("TOKEN_") || eventCode === "STAFF_FROZEN") return "store";
  if (eventCode.includes("PUSH")) return "push";
  if (eventCode.startsWith("APPROVAL_") || eventCode.startsWith("CROSS_AUTH_")) return "approval";
  if (eventCode === "BACKUP_FAIL" || eventCode === "HIGH_RISK_OP") return "ops";
  return "system";
}

const GROUP_KEYS = ["today", "yesterday", "thisWeek", "earlier"] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

const GROUP_LABEL_KEY: Record<GroupKey, MessageKey> = {
  today: "inbox.timeGroup.today",
  yesterday: "inbox.timeGroup.yesterday",
  thisWeek: "inbox.timeGroup.thisWeek",
  earlier: "inbox.timeGroup.earlier",
};

function groupByTime(items: InappMessage[]): Record<GroupKey, InappMessage[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const groups: Record<GroupKey, InappMessage[]> = { today: [], yesterday: [], thisWeek: [], earlier: [] };
  for (const m of items) {
    const t = new Date(m.createdAt);
    if (t >= today) groups.today.push(m);
    else if (t >= yesterday) groups.yesterday.push(m);
    else if (t >= weekStart) groups.thisWeek.push(m);
    else groups.earlier.push(m);
  }
  for (const k of GROUP_KEYS) {
    groups[k].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return groups;
}

export default function InboxPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [category, setCategory] = useState<Category>("all");
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
      toast.success(t("inbox.markAllReadDone").replace("{count}", String(r.updated)));
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

  const filtered = useMemo(
    () => (category === "all" ? items : items.filter((m) => categoryOf(m.eventCode) === category)),
    [items, category]
  );
  const grouped = useMemo(() => groupByTime(filtered), [filtered]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("inbox.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("inbox.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900">
            {t("inbox.unreadCount").replace("{count}", String(unread))}
          </span>
          <button
            onClick={handleMarkAllRead}
            disabled={unread === 0}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {t("inbox.markAllRead")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-background p-3">
        <div className="flex items-center gap-3">
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
                {k === "all" ? t("inbox.tab.all") : t("inbox.tab.unread")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <label className="text-xs text-muted-foreground">{t("inbox.filterCategory")}</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(CATEGORY_LABEL_KEY[c])}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">{t("inbox.totalCount").replace("{count}", String(total))}</div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <div className="space-y-4">
        {loading && <LoadingBlock />}
        {!loading && filtered.length === 0 && (
          <EmptyState
            title={t("inbox.empty.title")}
            hint={
              tab === "unread"
                ? t("inbox.empty.unread")
                : category !== "all"
                ? t("inbox.empty.category").replace("{name}", t(CATEGORY_LABEL_KEY[category]))
                : t("inbox.empty.waiting")
            }
          />
        )}
        {!loading &&
          filtered.length > 0 &&
          GROUP_KEYS.map((gk) => {
            const list = grouped[gk];
            if (list.length === 0) return null;
            return (
              <section key={gk} className="space-y-2">
                <div className="px-1 text-xs text-muted-foreground">
                  {t("inbox.groupCount")
                    .replace("{name}", t(GROUP_LABEL_KEY[gk]))
                    .replace("{count}", String(list.length))}
                </div>
                {list.map((m) => {
                  const isUnread = !m.readAt;
                  const isExpanded = expanded === m.id;
                  return (
                    <div
                      key={m.id}
                      className={
                        "rounded-md border transition-colors " +
                        (isUnread ? "border-primary/40 bg-primary/5" : "bg-background opacity-90")
                      }
                    >
                      <button
                        onClick={() => handleExpand(m)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/40"
                      >
                        <div
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: isUnread ? "#dc2626" : "transparent",
                            border: isUnread ? "none" : "1px solid #d4d4d8",
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                "truncate text-sm " +
                                (isUnread
                                  ? "font-semibold text-foreground"
                                  : "text-muted-foreground")
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
                                {t("inbox.linkOpen")}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
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
            {t("common.prev")}
          </button>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
          >
            {t("common.next")}
          </button>
        </div>
      )}
    </div>
  );
}
