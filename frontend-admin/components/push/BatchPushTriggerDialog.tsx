"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/StatusBlocks";
import { storeApi, type StoreItem } from "@/lib/api/store";
import { pushApi } from "@/lib/api/push";
import { useAuthStore } from "@/lib/auth/store";

/**
 * 批量推送多个产品到同一 Shopify 店铺（W2-PUSH-05）。
 * 提交后跳转 parent task 详情页，由 task 页轮询子任务进度。
 */
export function BatchPushTriggerDialog({
  open,
  onClose,
  productIds,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  productIds: number[];
  /** 推送提交成功后回调（清空选择等）。 */
  onSubmitted?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [storeId, setStoreId] = useState<number | "">("");
  const [loadingStores, setLoadingStores] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingStores(true);
    storeApi
      .list()
      .then((s) => setStores(s ?? []))
      .catch(() => {})
      .finally(() => setLoadingStores(false));
  }, [open]);

  useEffect(() => {
    if (!open) setStoreId("");
  }, [open]);

  async function submit() {
    if (!storeId) {
      toast.warn("请先选择目标店铺");
      return;
    }
    if (productIds.length === 0) {
      toast.warn("没有选中产品");
      return;
    }
    setSubmitting(true);
    try {
      const r = await pushApi.pushBatch({
        productIds,
        storeId: Number(storeId),
        triggeredBy: userId,
      });
      toast.success(
        `批量推送已创建：成功 ${r.summary.success} / 失败 ${r.summary.failed}`
      );
      onSubmitted?.();
      onClose();
      router.push(`/tasks/${r.parentTaskId}`);
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
      title="批量推送到 Shopify 店铺"
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
            {submitting && <Spinner className="mr-1" />}确认推送 ({productIds.length})
          </button>
        </>
      }
    >
      <div>
        将推送 <span className="font-semibold">{productIds.length}</span> 个产品到所选店铺。
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">目标店铺</label>
        {loadingStores ? (
          <Spinner />
        ) : stores.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            暂无可用店铺，先去“店铺”菜单连接一个 Shopify 店铺。
          </p>
        ) : (
          <select
            value={storeId}
            onChange={(e) =>
              setStoreId(e.target.value ? Number(e.target.value) : "")
            }
            className="w-full rounded-md border bg-background px-2 py-1.5"
          >
            <option value="">— 请选择 —</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.brandName ?? s.myshopifyDomain} ({s.myshopifyDomain})
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        后端串行推送、共享一个 parent task；提交后跳转 parent task 页查看每个产品的子任务进度。
      </p>
    </Dialog>
  );
}
