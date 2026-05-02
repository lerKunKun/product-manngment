"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/StatusBlocks";
import { previewApi, PREVIEW_STATUS_BADGE } from "@/lib/api/preview";
import { useAuthStore } from "@/lib/auth/store";

/**
 * W3-PV-02: 一键预览按钮。点 → POST /preview → 后端同步驱动 worker → 拿到
 * READY 行 + previewUrl 后直接 window.open；FAILED 弹错误 toast；PENDING/BUILDING
 * （worker 太慢 / 离线）提示去合作者池查看。
 *
 * 不阻塞产品详情页：所有失败都吞到 toast，不抛到 ErrorBoundary。
 */
export function PreviewButton({
  productId,
  tenantId,
}: {
  productId: number;
  /** 显式覆盖 tenantId；缺省时退回 user.tenantId 或 1。 */
  tenantId?: number;
}) {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);

  async function trigger() {
    if (!user) {
      toast.error("未登录");
      return;
    }
    // user 上目前没有 tenantId（auth/store.AuthUser 未携带），与后端约定默认 1。
    const tid =
      tenantId ??
      (user as unknown as { tenantId?: number }).tenantId ??
      1;
    setBusy(true);
    try {
      const p = await previewApi.allocate(tid, productId);
      if (p.status === "READY" && p.previewUrl) {
        window.open(p.previewUrl, "_blank", "noopener,noreferrer");
        // best-effort 标记已访问，失败不影响 UX
        previewApi.markAccessed(p.id).catch(() => {});
        toast.success("预览已打开（新标签页）");
      } else if (p.status === "FAILED") {
        toast.error(
          "预览构建失败：" + (p.errorMessage ?? "未知错误，请查看后端日志")
        );
      } else {
        const label = PREVIEW_STATUS_BADGE[p.status]?.text ?? p.status;
        toast.info(
          `预览仍在 ${label}（status=${p.status}），稍后请到「合作者店铺池」查看`
        );
      }
    } catch {
      // request() 已经全局 toast 了，这里就别重复
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={busy}
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
      title="在合作者 dev store 上创建临时主题并打开预览"
    >
      {busy ? (
        <>
          <Spinner className="mr-1" />
          预览中…
        </>
      ) : (
        <>预览</>
      )}
    </button>
  );
}
