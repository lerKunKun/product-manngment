"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/StatusBlocks";
import { crossAuthApi, type CrossAuthGrantRequest } from "@/lib/api/crossAuth";
import { useAuthStore } from "@/lib/auth/store";

const SENSITIVE_ACTION = "CROSS_AUTH_GRANT";

/**
 * 创建跨公司授权（敏感操作）。
 *
 * 校验：
 *  - 必填：userId / scopeId / expiresAt
 *  - expiresAt 必须 5 分钟以后；最长 180 天
 * 敏感流程：与 productApi/recycleApi 复用 /auth/sensitive/request|verify 端点；
 *   用户输入钉钉 6 位码 → 拿 token → 带 X-Sensitive-Token 头调 grant。
 *   若用户取消验证码输入，按用户主动取消处理。
 */
export function CrossAuthGrantDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const toast = useToast();
  const me = useAuthStore((s) => s.user);
  const [userId, setUserId] = useState("");
  const [scopeType, setScopeType] = useState("COMPANY");
  const [scopeId, setScopeId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 默认 +7 天，并按 datetime-local 需要的本地时区格式化（避免 toISOString 的 UTC 偏移）。
  useEffect(() => {
    if (!open) return;
    const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setExpiresAt(local);
    setUserId("");
    setScopeType("COMPANY");
    setScopeId("");
  }, [open]);

  async function submit() {
    if (!userId || !scopeId || !expiresAt) {
      toast.warn("请填完所有字段");
      return;
    }
    const expDate = new Date(expiresAt);
    const expMs = expDate.getTime();
    if (Number.isNaN(expMs)) {
      toast.warn("过期时间格式错误");
      return;
    }
    const now = Date.now();
    if (expMs - now < 5 * 60 * 1000) {
      toast.warn("过期时间至少 5 分钟以后");
      return;
    }
    if (expMs - now > 180 * 24 * 3600 * 1000) {
      toast.warn("最长 180 天");
      return;
    }

    const req: CrossAuthGrantRequest = {
      userId: Number(userId),
      scopeType,
      scopeId: Number(scopeId),
      expiresAt: expDate.toISOString(),
      grantedBy: me?.userId,
      // granterCompanyId 暂由后端从 JWT 推断（AuthUser 类型未暴露 tenantId，前端不强塞）
    };

    setSubmitting(true);
    try {
      // 敏感操作：先请求钉钉验证码，prompt 输入后换 sensitiveToken。
      await crossAuthApi.requestSensitiveCode(SENSITIVE_ACTION);
      const code = window.prompt(
        "钉钉收到的 6 位验证码（钉钉未配 dingtalk_userid 时看 backend 日志）："
      );
      if (!code) {
        toast.info("已取消");
        return;
      }
      const { sensitiveToken } = await crossAuthApi.verifySensitive(SENSITIVE_ACTION, code);
      const newId = await crossAuthApi.grant(req, sensitiveToken);
      toast.success(`授权创建成功 (id=${newId})`);
      onCreated?.();
      onClose();
    } catch {
      /* 全局 toast 已上报 */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="创建跨公司授权"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting && <Spinner className="mr-1" />}确认
          </button>
        </>
      }
    >
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">受让人 用户 ID</label>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          inputMode="numeric"
          placeholder="例如 1234"
          className="w-full rounded-md border bg-background px-2 py-1.5"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">范围类型</label>
        <select
          value={scopeType}
          onChange={(e) => setScopeType(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1.5"
        >
          <option value="COMPANY">COMPANY（整公司）</option>
          <option value="ORG">ORG（部门）</option>
          <option value="STORE">STORE（单店）</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          范围 ID（公司 / 部门 / 店铺 ID）
        </label>
        <input
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
          inputMode="numeric"
          placeholder="例如 1"
          className="w-full rounded-md border bg-background px-2 py-1.5"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          过期时间（5 分钟 ~ 180 天）
        </label>
        <input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1.5"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        敏感操作：提交时会触发钉钉 6 位验证码二次确认（W1-AUTH-06）。
      </p>
    </Dialog>
  );
}
