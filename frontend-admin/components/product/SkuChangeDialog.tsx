"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/StatusBlocks";
import { purchaseApi } from "@/lib/api/purchase";

const SENSITIVE_ACTION = "PURCHASE_SKU_EDIT";

/**
 * 修改变体 SKU 的二次确认对话框：先请求钉钉验证码 → 验证拿 token → 调 changeSku。
 */
export function SkuChangeDialog({
  open,
  onClose,
  variantId,
  currentSku,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  variantId: number;
  currentSku: string;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<"input" | "code">("input");
  const [newSku, setNewSku] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("input");
    setNewSku("");
    setCode("");
    setBusy(false);
  }, [open]);

  async function requestCode() {
    if (!newSku.trim()) {
      toast.warn("请输入新 SKU");
      return;
    }
    if (newSku.trim() === currentSku) {
      toast.warn("新 SKU 与当前相同");
      return;
    }
    setBusy(true);
    try {
      await purchaseApi.requestSensitiveCode(SENSITIVE_ACTION);
      toast.info("验证码已发送到钉钉");
      setStep("code");
    } catch {
      /* toast 已上报 */
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!code.trim() || code.trim().length !== 6) {
      toast.warn("请输入 6 位验证码");
      return;
    }
    setBusy(true);
    try {
      const { sensitiveToken } = await purchaseApi.verifySensitive(SENSITIVE_ACTION, code.trim());
      await purchaseApi.changeSku(variantId, newSku.trim(), sensitiveToken);
      toast.success("已提交多店同步，可在 SKU 变更历史查看");
      onChanged?.();
      onClose();
    } catch {
      /* toast 已上报 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="修改 SKU（敏感操作）"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            取消
          </button>
          {step === "input" ? (
            <button
              type="button"
              onClick={requestCode}
              disabled={busy}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Spinner className="mr-1" />}发送验证码
            </button>
          ) : (
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Spinner className="mr-1" />}确认变更
            </button>
          )}
        </>
      }
    >
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">当前 SKU</label>
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 font-mono text-sm">{currentSku || "—"}</div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">新 SKU</label>
        <input
          value={newSku}
          onChange={(e) => setNewSku(e.target.value)}
          disabled={step === "code"}
          placeholder="例如 SKU-RED-XL"
          className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm disabled:opacity-60"
        />
      </div>
      {step === "code" && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">钉钉收到的 6 位验证码</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="6 位数字"
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm tracking-widest"
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        改 SKU 会写入 sku_change_log 并同步到所有已映射的店铺。
      </p>
    </Dialog>
  );
}
