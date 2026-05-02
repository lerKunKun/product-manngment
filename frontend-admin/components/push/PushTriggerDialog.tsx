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
 * 立即推送产品到 Shopify 店铺（W2-PUSH-06）。
 * - 选店铺：复用 storeApi.list()（按 JWT 过滤当前租户）
 * - triggeredBy：取自 useAuthStore() 当前用户 id
 * - 提交：POST /push/product → 拿到 taskId 后跳转 /tasks/[id]，让用户看到轮询的进度
 */
export function PushTriggerDialog({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product: { id: number; handle: string; title: string };
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
      .catch(() => {
        /* 全局 toast 已上报 */
      })
      .finally(() => setLoadingStores(false));
  }, [open]);

  // 关闭时清空一次性输入
  useEffect(() => {
    if (!open) {
      setStoreId("");
    }
  }, [open]);

  async function submit() {
    if (!storeId) {
      toast.warn("请先选择目标店铺");
      return;
    }
    setSubmitting(true);
    try {
      const r = await pushApi.push({
        productId: product.id,
        storeId: Number(storeId),
        triggeredBy: userId,
      });
      toast.success(`推送任务已创建 (taskId=${r.taskId})`);
      onClose();
      // 跳转到任务详情页（轮询展示进度）
      router.push(`/tasks/${r.taskId}`);
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
      title="推送到 Shopify 店铺"
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
            {submitting && <Spinner className="mr-1" />}确认推送
          </button>
        </>
      }
    >
      <div>
        产品：<span className="font-mono text-xs">{product.handle}</span> ·{" "}
        {product.title}
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
        推送会创建一条 PRODUCT_PUSH 任务；提交后跳转任务详情页，5 秒轮询一次直到完成。
      </p>
    </Dialog>
  );
}
