"use client";

/**
 * W3-NEW-10: saga 进度页
 *
 * - 优先 SSE：subscribeSagaEvents
 * - SSE onError 触发降级到 3s 轮询
 * - INIT 状态下显示 dev mock-auth 表单
 * - FAILED 显示重试 + 错误详情
 * - 当前 step 匹配 MEDIA / COLLECTIONS / PRODUCTS 时显示 “手动推进” 按钮
 * - GUIDE / THEME / PUBLISH 显示禁用占位（W3-NEW-06+ 后续）
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  sagaApi,
  subscribeSagaEvents,
  SAGA_STEPS,
  SAGA_STEP_LABEL,
  SAGA_STATUS_BADGE,
  type SagaState,
} from "@/lib/api/saga";
import { useToast } from "@/components/ui/Toast";
import {
  ErrorBanner,
  LoadingBlock,
  Spinner,
} from "@/components/ui/StatusBlocks";

const POLL_INTERVAL_MS = 3000;

export default function SagaProgressPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = Number(params.taskId);
  const toast = useToast();

  const [state, setState] = useState<SagaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamMode, setStreamMode] = useState<"sse" | "poll" | "init">("init");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const [mockShopDomain, setMockShopDomain] = useState("");
  const [mockAccessToken, setMockAccessToken] = useState("");
  const [showCtx, setShowCtx] = useState(false);

  const stateRef = useRef<SagaState | null>(null);
  stateRef.current = state;

  async function refresh(silent = false) {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const s = await sagaApi.get(taskId);
      setState(s);
    } catch (e) {
      if (!silent) setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // initial fetch + subscribe
  useEffect(() => {
    if (!taskId || isNaN(taskId)) return;
    let unsub: (() => void) | null = null;
    let pollTimer: number | null = null;
    let cancelled = false;

    (async () => {
      try {
        const s = await sagaApi.get(taskId);
        if (cancelled) return;
        setState(s);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
        return;
      }

      // Try SSE
      let sseGotAny = false;
      let switched = false;
      const switchToPoll = () => {
        if (switched) return;
        switched = true;
        setStreamMode("poll");
        pollTimer = window.setInterval(() => {
          // 终态时仍刷新一次后停止
          const s = stateRef.current;
          if (s && (s.status === "SUCCESS" || s.status === "FAILED" || s.status === "CANCELED")) {
            // 终态时停掉轮询
            if (pollTimer != null) {
              window.clearInterval(pollTimer);
              pollTimer = null;
            }
            return;
          }
          refresh(true);
        }, POLL_INTERVAL_MS);
      };

      unsub = subscribeSagaEvents(
        taskId,
        (ev) => {
          sseGotAny = true;
          if (!switched) setStreamMode("sse");
          // 事件可能直接是 SagaState，也可能是 { type, payload }
          const obj = ev as Record<string, unknown>;
          if (obj && typeof obj === "object") {
            if ("step" in obj && "status" in obj && "taskId" in obj) {
              setState(obj as unknown as SagaState);
            } else if ("payload" in obj && obj.payload && typeof obj.payload === "object") {
              const p = obj.payload as Record<string, unknown>;
              if ("step" in p && "status" in p) {
                setState(p as unknown as SagaState);
              } else {
                refresh(true);
              }
            } else {
              refresh(true);
            }
          }
        },
        () => {
          // SSE 失败 / 后端未实现 -> 降级为轮询
          if (!sseGotAny) {
            // 没收到任何事件，直接降级
          }
          switchToPoll();
        }
      );
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
      if (pollTimer != null) window.clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function doAction(label: string, fn: () => Promise<unknown>) {
    setActionBusy(label);
    try {
      await fn();
      toast.success(`${label} OK`);
      await refresh(true);
    } catch (e) {
      toast.error(`${label} 失败：${(e as Error).message}`);
    } finally {
      setActionBusy(null);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={() => refresh()} />;
  if (!state) {
    return (
      <div className="space-y-3">
        <Link
          href="/newstore"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回列表
        </Link>
        <div className="rounded-md border bg-background p-6 text-sm text-muted-foreground">
          未找到 saga taskId={taskId}
        </div>
      </div>
    );
  }

  const cls =
    SAGA_STATUS_BADGE[state.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";
  const currentStepIdx = SAGA_STEPS.indexOf(state.step as (typeof SAGA_STEPS)[number]);

  const isFailed = state.status === "FAILED";
  const isInit = state.step === "INIT";
  const ctxString = state.context ? JSON.stringify(state.context, null, 2) : "{}";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/newstore"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回列表
        </Link>
        <h1 className="text-2xl font-semibold">Saga #{state.taskId}</h1>
        <span
          className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}
        >
          {state.status}
        </span>
        <span className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
          step: {state.step}
        </span>
        <span className="rounded border bg-muted px-2 py-0.5 text-xs">
          attempt {state.attempt}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {streamMode === "sse"
            ? "SSE 实时"
            : streamMode === "poll"
              ? `轮询 ${POLL_INTERVAL_MS / 1000}s`
              : "连接中…"}
        </span>
        <button
          type="button"
          onClick={() => refresh()}
          className="rounded border px-3 py-1 text-xs hover:bg-accent"
        >
          手动刷新
        </button>
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {SAGA_STEPS.map((s, i) => {
          const active = i === currentStepIdx;
          const done = currentStepIdx > i || state.status === "SUCCESS";
          return (
            <li key={s} className="flex items-center gap-1">
              <span
                className={
                  "rounded-full border px-3 py-1 transition-colors " +
                  (active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-zinc-300 text-zinc-500")
                }
              >
                {i + 1}. {SAGA_STEP_LABEL[s] ?? s}
              </span>
              {i < SAGA_STEPS.length - 1 && (
                <span className="text-zinc-300">→</span>
              )}
            </li>
          );
        })}
      </ol>

      {isFailed && state.errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-medium">失败原因</div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
            {state.errorMessage}
          </pre>
        </div>
      )}

      {isFailed && (
        <div className="rounded-md border bg-background p-3">
          <button
            type="button"
            disabled={actionBusy === "重试"}
            onClick={() =>
              doAction("重试", () => sagaApi.retry(state.taskId))
            }
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {actionBusy === "重试" ? <><Spinner /> 重试中…</> : "重试 Saga"}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            attempt 会 +1，状态从 FAILED 回到 RUNNING。
          </p>
        </div>
      )}

      {isInit && (
        <section className="space-y-3 rounded-md border bg-background p-4">
          <h3 className="text-sm font-medium">Dev Mock 授权（INIT 状态可用）</h3>
          <p className="text-xs text-muted-foreground">
            将 saga 从 INIT 推进到 AUTH_DONE；仅开发环境使用。
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={mockShopDomain}
              onChange={(e) => setMockShopDomain(e.target.value)}
              placeholder="dev-store.myshopify.com"
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              value={mockAccessToken}
              onChange={(e) => setMockAccessToken(e.target.value)}
              placeholder="shpat_xxx"
              className="rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="button"
            disabled={
              actionBusy === "Mock 授权" ||
              !mockShopDomain.trim() ||
              !mockAccessToken.trim()
            }
            onClick={() =>
              doAction("Mock 授权", () =>
                sagaApi.mockAuth(
                  state.taskId,
                  mockShopDomain.trim().toLowerCase(),
                  mockAccessToken
                )
              )
            }
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {actionBusy === "Mock 授权" ? <><Spinner /> 提交中…</> : "提交 Mock 授权"}
          </button>
        </section>
      )}

      {/* Manual step buttons */}
      <section className="space-y-3 rounded-md border bg-background p-4">
        <h3 className="text-sm font-medium">手动推进（dev/admin override）</h3>
        <p className="text-xs text-muted-foreground">
          仅当当前 step 匹配时按钮可点击。后端会根据状态机校验合法性。
        </p>
        <div className="flex flex-wrap gap-2">
          <StepButton
            label="run-media"
            requireStep="AUTH_DONE"
            currentStep={state.step}
            busy={actionBusy === "run-media"}
            onClick={() =>
              doAction("run-media", () => sagaApi.runStep(state.taskId, "media"))
            }
          />
          <StepButton
            label="run-collections"
            requireStep="MEDIA"
            currentStep={state.step}
            busy={actionBusy === "run-collections"}
            onClick={() =>
              doAction("run-collections", () =>
                sagaApi.runStep(state.taskId, "collections")
              )
            }
          />
          <StepButton
            label="run-products"
            requireStep="COLLECTIONS"
            currentStep={state.step}
            busy={actionBusy === "run-products"}
            onClick={() =>
              doAction("run-products", () =>
                sagaApi.runStep(state.taskId, "products")
              )
            }
          />
          <button
            type="button"
            disabled
            title="W3-NEW-06+ 后续"
            className="rounded-md border bg-muted px-3 py-1.5 text-xs text-muted-foreground"
          >
            run-guide (W3-NEW-06+ 后续)
          </button>
          <button
            type="button"
            disabled
            title="W3-NEW-06+ 后续"
            className="rounded-md border bg-muted px-3 py-1.5 text-xs text-muted-foreground"
          >
            run-theme (W3-NEW-06+ 后续)
          </button>
          <button
            type="button"
            disabled
            title="W3-NEW-06+ 后续"
            className="rounded-md border bg-muted px-3 py-1.5 text-xs text-muted-foreground"
          >
            run-publish (W3-NEW-06+ 后续)
          </button>
        </div>
      </section>

      {/* meta */}
      <section className="rounded-md border bg-background p-4 text-sm">
        <dl className="grid gap-x-6 gap-y-2 md:grid-cols-3">
          <Field
            label="开始时间"
            value={
              state.startedAt
                ? new Date(state.startedAt).toLocaleString("zh-CN")
                : "-"
            }
          />
          <Field
            label="完成时间"
            value={
              state.completedAt
                ? new Date(state.completedAt).toLocaleString("zh-CN")
                : "-"
            }
          />
          <Field label="重试次数" value={state.attempt} />
        </dl>
      </section>

      {/* context */}
      <details
        open={showCtx}
        onToggle={(e) => setShowCtx((e.target as HTMLDetailsElement).open)}
        className="rounded-md border bg-background p-4 text-sm"
      >
        <summary className="cursor-pointer select-none font-medium">
          Saga Context (step outputs)
        </summary>
        <pre className="mt-3 max-h-[480px] overflow-auto rounded border bg-muted/30 p-3 font-mono text-xs">
          {ctxString}
        </pre>
      </details>
    </div>
  );
}

function StepButton({
  label,
  requireStep,
  currentStep,
  busy,
  onClick,
}: {
  label: string;
  requireStep: string;
  currentStep: string;
  busy: boolean;
  onClick: () => void;
}) {
  const enabled = currentStep === requireStep && !busy;
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      title={
        currentStep === requireStep
          ? `推进：${requireStep} → next`
          : `仅在 step=${requireStep} 时可点击（当前 ${currentStep}）`
      }
      className={
        "rounded-md border px-3 py-1.5 text-xs " +
        (enabled
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground")
      }
    >
      {busy ? (
        <>
          <Spinner /> {label}
        </>
      ) : (
        label
      )}
    </button>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
