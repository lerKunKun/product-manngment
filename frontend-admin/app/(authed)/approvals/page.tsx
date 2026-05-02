"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, EmptyState, ErrorBanner } from "@/components/ui/StatusBlocks";
import {
  approvalApi,
  STATUS_BADGE,
  TYPE_LABEL,
  type ApprovalFlow,
} from "@/lib/api/approval";
import { useAuthStore } from "@/lib/auth/store";
import type { ApiError } from "@/lib/api/client";

type Tab = "mine" | "todo" | "all";

const STATUS_FILTERS = [
  { v: "", label: "全部" },
  { v: "PENDING", label: "待审批" },
  { v: "APPROVED", label: "已通过" },
  { v: "REJECTED", label: "已驳回" },
  { v: "CANCELLED", label: "已撤回" },
];

export default function ApprovalsPage() {
  const toast = useToast();
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("todo");
  const [status, setStatus] = useState<string>("");
  const [list, setList] = useState<ApprovalFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data =
        tab === "todo"
          ? await approvalApi.myPending()
          : await approvalApi.list({
              status: status || undefined,
              applicantId: tab === "mine" && me?.userId ? Number(me.userId) : undefined,
            });
      setList(data ?? []);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [tab, status, me?.userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(id: number) {
    if (!confirm(`撤回审批 #${id}？`)) return;
    try {
      await approvalApi.cancel(id);
      toast.success(`#${id} 已撤回`);
      load();
    } catch {
      /* toast 已上报 */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">审批中心</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            产品库使用权 / 跨公司授权 等申请的待办、提交记录与历史。
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3">
        <div className="flex gap-1 text-sm">
          {[
            { v: "todo", label: "我审批的" },
            { v: "mine", label: "我提交的" },
            { v: "all", label: "全部" },
          ].map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v as Tab)}
              className={
                "rounded-md border px-3 py-1.5 transition-colors " +
                (tab === t.v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== "todo" && (
          <div className="flex gap-1 text-sm">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.v}
                onClick={() => setStatus(opt.v)}
                className={
                  "rounded-md border px-3 py-1.5 transition-colors " +
                  (status === opt.v
                    ? "border-primary bg-primary text-primary-foreground"
                    : "")
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {loading ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyState title="暂无审批" />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">申请人</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">创建</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => {
                const sb = STATUS_BADGE[f.status] ?? {
                  text: f.status,
                  cls: "bg-zinc-100 border-zinc-300",
                };
                return (
                  <tr key={f.id} className="border-t">
                    <td className="px-3 py-2 font-mono">{f.id}</td>
                    <td className="px-3 py-2">{TYPE_LABEL[f.type] ?? f.type}</td>
                    <td className="px-3 py-2">{f.applicantId}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-xs ${sb.cls}`}
                      >
                        {sb.text}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {f.createdAt?.replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/approvals/${f.id}`}
                        className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
                      >
                        详情
                      </Link>
                      {f.status === "PENDING" &&
                        Number(f.applicantId) === Number(me?.userId) && (
                          <button
                            onClick={() => cancel(f.id)}
                            className="ml-2 rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
                          >
                            撤回
                          </button>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
