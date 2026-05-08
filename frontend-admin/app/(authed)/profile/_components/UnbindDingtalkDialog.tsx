"use client";

// 解绑钉钉 + 设新密码 二合一对话框。
// - 不通过 SensitiveActionDialog（那个只有验证码） —— 这里需要 验证码 + 2 次新密码 三项一起提交
// - 流程：发码 → 输码 + 输 2 次新密码 → 「解绑确认」按钮 →
//         verifySensitiveCode 拿 token → POST /auth/dingtalk/unbind {newPassword} 带 token

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/StatusBlocks";
import { useToast } from "@/components/ui/Toast";
import { authApi } from "@/lib/api/auth";
import type { ApiError } from "@/lib/api/client";

const ACTION = "DINGTALK_UNBIND";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function UnbindDingtalkDialog({
  open,
  onClose,
  onUnbound,
}: {
  open: boolean;
  onClose: () => void;
  onUnbound: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [devFallback, setDevFallback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setCode("");
    setNewPwd("");
    setConfirmPwd("");
    setSending(false);
    setSent(false);
    setDevFallback(false);
    setSubmitting(false);
    setError("");
  }

  async function sendCode() {
    setSending(true);
    setError("");
    try {
      const r = await authApi.sendSensitiveCode(ACTION);
      setSent(true);
      setDevFallback(!!r?.devFallback);
      if (r?.devFallback) {
        toast.warn("钉钉未发出，验证码已打印到后端日志（dev fallback）");
      } else {
        toast.success("验证码已发送到钉钉");
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSending(false);
    }
  }

  function validateForm(): string | null {
    if (!code.trim()) return "请输入钉钉验证码";
    if (!/^\d{6}$/.test(code.trim())) return "验证码为 6 位数字";
    if (newPwd.length < 8) return "新密码至少 8 位";
    if (newPwd !== confirmPwd) return "两次输入的新密码不一致";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // 1. 验证码 → sensitiveToken
      const { sensitiveToken } = await authApi.verifySensitiveCode(ACTION, code.trim());
      // 2. 带 token 解绑 + 设新密码
      await authApi.dingtalkUnbind(sensitiveToken, newPwd);
      toast.success("已解绑，新密码已生效");
      reset();
      onUnbound();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (sending || submitting) return;
        reset();
        onClose();
      }}
      title="解绑钉钉"
      className="max-w-md"
    >
      <p className="text-xs text-muted-foreground">
        解绑后将无法用钉钉扫码登录。系统会同时设置一遍新密码（不需要旧密码），
        以确保解绑后你仍能用账号 + 密码登录。
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        {/* 发送验证码 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={sendCode}
            disabled={sending || submitting}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {sending && <Spinner />}
            {sent ? "重新发送" : "发送钉钉验证码"}
          </button>
          {sent && !devFallback && (
            <span className="text-[11px] text-muted-foreground">已发送，请在钉钉查看</span>
          )}
        </div>

        {sent && devFallback && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            钉钉未发出，验证码已打印到后端日志（dev fallback）
          </div>
        )}

        <Field label="钉钉验证码（6 位）" required>
          <input
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            placeholder="000000"
            disabled={!sent || submitting}
            className="w-32 rounded-md border bg-background px-3 py-2 font-mono text-base tracking-widest disabled:bg-muted/50"
          />
        </Field>

        <Field label="新密码（至少 8 位）" required>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            disabled={submitting}
            autoComplete="new-password"
            className={inp}
          />
        </Field>

        <Field label="再次输入新密码" required>
          <input
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            disabled={submitting}
            autoComplete="new-password"
            className={inp}
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t pt-3">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={submitting}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting || !sent}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "解绑中..." : "解绑确认"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}
