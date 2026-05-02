"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, ErrorBanner } from "@/components/ui/StatusBlocks";
import {
  approvalApi,
  STATUS_BADGE,
  TYPE_LABEL,
  type ApprovalDetail,
} from "@/lib/api/approval";
import { useAuthStore } from "@/lib/auth/store";
import type { ApiError } from "@/lib/api/client";

const ACTION_LABEL: Record<string, string> = {
  SUBMIT: "提交",
  APPROVE: "通过",
  REJECT: "驳回",
  RESUBMIT: "重新提交",
  CANCEL: "撤回",
};

export default function ApprovalDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const toast = useToast();
  const me = useAuthStore((s) => s.user);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [resubmitJson, setResubmitJson] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const d = await approvalApi.get(id);
      setDetail(d);
      setResubmitJson(JSON.stringify(d.flow.payload ?? {}, null, 2));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve() {
    try {
      await approvalApi.approve(id, comment || undefined);
      toast.success("已通过");
      load();
    } catch {
      /* toast 已上报 */
    }
  }
  async function reject() {
    if (!comment.trim()) {
      toast.info("驳回需填写理由");
      return;
    }
    try {
      await approvalApi.reject(id, comment);
      toast.success("已驳回");
      load();
    } catch {
      /* toast 已上报 */
    }
  }
  async function resubmit() {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(resubmitJson);
    } catch {
      toast.error("payload 不是合法 JSON");
      return;
    }
    try {
      await approvalApi.resubmit(id, payload);
      toast.success("已重新提交");
      load();
    } catch {
      /* toast 已上报 */
    }
  }
  async function cancel() {
    if (!confirm(`撤回 #${id}？`)) return;
    try {
      await approvalApi.cancel(id);
      toast.success("已撤回");
      load();
    } catch {
      /* toast 已上报 */
    }
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} />;
  if (!detail) return null;

  const f = detail.flow;
  const sb = STATUS_BADGE[f.status] ?? {
    text: f.status,
    cls: "bg-zinc-100 border-zinc-300",
  };
  const isApplicant = Number(f.applicantId) === Number(me?.userId);
  const isApprover =
    Number(f.currentApproverId) === Number(me?.userId);
  const canDecide = f.status === "PENDING" && isApprover;
  const canResubmit = f.status === "REJECTED" && isApplicant;
  const canCancel = f.status === "PENDING" && isApplicant;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/approvals"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← 返回审批列表
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            审批 #{f.id} ·{" "}
            <span className="text-base text-muted-foreground">
              {TYPE_LABEL[f.type] ?? f.type}
            </span>
          </h1>
        </div>
        <span
          className={`inline-block rounded-md border px-2 py-1 text-xs ${sb.cls}`}
        >
          {sb.text}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-background p-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">申请人</div>
          <div className="font-mono">{f.applicantId}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">受益人</div>
          <div className="font-mono">{f.targetUserId ?? f.applicantId}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">当前审批人</div>
          <div className="font-mono">
            {f.currentApproverId
              ? `userId=${f.currentApproverId}`
              : f.currentApproverRole
                ? `role=${f.currentApproverRole}`
                : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">最终决策</div>
          <div className="font-mono">
            {f.decidedBy ? `${f.decidedBy} @ ${f.decidedAt?.replace("T", " ").slice(0, 16)}` : "—"}
          </div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-muted-foreground">决策说明</div>
          <div className="whitespace-pre-wrap">{f.decisionComment || "—"}</div>
        </div>
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="mb-2 text-xs text-muted-foreground">payload</div>
        <pre className="overflow-x-auto rounded bg-muted/30 p-3 text-xs">
          {JSON.stringify(f.payload ?? {}, null, 2)}
        </pre>
      </div>

      {(canDecide || canResubmit) && (
        <div className="rounded-lg border bg-background p-4">
          {canDecide && (
            <>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="审批意见（驳回必填，通过可空）"
                className="h-24 w-full rounded-md border bg-background p-2 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={approve}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  通过
                </button>
                <button
                  onClick={reject}
                  className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  驳回
                </button>
              </div>
            </>
          )}
          {canResubmit && (
            <>
              <div className="mb-2 text-sm font-medium">修改 payload 后重新提交</div>
              <textarea
                value={resubmitJson}
                onChange={(e) => setResubmitJson(e.target.value)}
                className="h-44 w-full rounded-md border bg-background p-2 font-mono text-xs"
              />
              <button
                onClick={resubmit}
                className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                重新提交
              </button>
            </>
          )}
        </div>
      )}

      {canCancel && (
        <button
          onClick={cancel}
          className="rounded-md border bg-background px-4 py-2 text-sm hover:bg-accent"
        >
          撤回此申请
        </button>
      )}

      <div className="rounded-lg border bg-background p-4">
        <div className="mb-3 text-sm font-medium">审批轨迹</div>
        {detail.logs.length === 0 ? (
          <div className="text-xs text-muted-foreground">无</div>
        ) : (
          <ol className="space-y-3 text-sm">
            {detail.logs.map((l) => (
              <li
                key={l.id}
                className="rounded-md border-l-2 border-primary/40 bg-muted/20 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {ACTION_LABEL[l.action] ?? l.action} · userId={l.actorId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {l.createdAt?.replace("T", " ").slice(0, 19)}
                  </span>
                </div>
                {l.comment && (
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {l.comment}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
