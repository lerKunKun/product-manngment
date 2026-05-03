"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/StatusBlocks";
import { useToast } from "@/components/ui/Toast";
import { authApi } from "@/lib/api/auth";
import { useI18n } from "@/lib/i18n/context";

/**
 * F4：钉钉验证码二次确认弹窗。
 *
 * 用法：
 *   <SensitiveActionDialog
 *     open={open}
 *     action="DELETE_PRODUCTS"
 *     description="删除选中的 12 个产品"
 *     onClose={() => setOpen(false)}
 *     onConfirmed={(token) => doDelete(token)}
 *   />
 *
 * 流程：
 *   1. 点击「发送验证码到钉钉」 → POST /auth/sensitive-code/send {action}
 *   2. 用户输入收到的 6 位数字
 *   3. 点击「确认」 → POST /auth/sensitive-code/verify → 拿到 sensitiveToken
 *   4. 调用方在敏感接口 header 带 X-Sensitive-Token: <token>
 */
export function SensitiveActionDialog({
  open,
  action,
  description,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  action: string;
  description?: string;
  onClose: () => void;
  onConfirmed: (sensitiveToken: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(false);
  const [devFallback, setDevFallback] = useState(false);

  function reset() {
    setCode("");
    setSent(false);
    setSending(false);
    setVerifying(false);
    setDevFallback(false);
  }

  async function sendCode() {
    setSending(true);
    try {
      const resp = await authApi.sendSensitiveCode(action);
      setSent(true);
      // dev fallback：钉钉没发出，码只打到后端日志（生产 devFallback 永远 false）
      const isFallback = !!resp?.devFallback;
      setDevFallback(isFallback);
      if (isFallback) {
        toast.warn(t("sensitiveCode.devFallback"));
      } else {
        toast.success(t("sensitiveCode.sent"));
      }
    } catch {
      /* 全局 toast */
    } finally {
      setSending(false);
    }
  }

  async function confirm() {
    const c = code.trim();
    if (!c) {
      toast.warn(t("sensitiveCode.codeRequired"));
      return;
    }
    setVerifying(true);
    try {
      const { sensitiveToken } = await authApi.verifySensitiveCode(action, c);
      await onConfirmed(sensitiveToken);
      reset();
      onClose();
    } catch {
      /* 全局 toast */
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (sending || verifying ? undefined : (reset(), onClose()))}
      title={t("sensitiveCode.title")}
      footer={
        <>
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={sending || verifying}
            className="rounded border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={confirm}
            disabled={!sent || verifying || !code.trim()}
            className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {verifying && <Spinner />}
            {t("sensitiveCode.confirm")}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-xs text-muted-foreground">{t("sensitiveCode.action")}</div>
          <div className="mt-0.5 break-all font-mono text-xs">{action}</div>
          {description && (
            <div className="mt-1 text-sm text-foreground">{description}</div>
          )}
        </div>

        <div>
          <button
            onClick={sendCode}
            disabled={sending}
            className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {sending && <Spinner />}
            {sent ? t("sensitiveCode.resend") : t("sensitiveCode.send")}
          </button>
          {sent && !devFallback && (
            <span className="ml-2 text-xs text-muted-foreground">
              {t("sensitiveCode.sentHint")}
            </span>
          )}
        </div>

        {sent && devFallback && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t("sensitiveCode.devFallback")}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {t("sensitiveCode.codeLabel")}
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="000000"
            className="w-32 rounded-md border bg-background px-2 py-1.5 font-mono text-base tracking-widest"
            disabled={!sent || verifying}
          />
        </div>
      </div>
    </Dialog>
  );
}
