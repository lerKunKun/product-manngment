"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/StatusBlocks";
import { storeApi, type StoreItem } from "@/lib/api/store";
import { productSnapshotApi } from "@/lib/api/snapshot";

/**
 * 立即触发产品快照（替换原 prompt() UI）。
 * - 店铺通过下拉选择，避免手输 storeId。
 * - 产品 external_id 暂时手填；TODO 后续从 store_product 映射回填。
 * - tenantId 取自所选店铺（storeApi.list() 已按 JWT 过滤当前租户）；
 *   若后端响应未带 tenantId，回退到 1，与历史 prompt 行为一致。
 */
export function SnapshotTriggerDialog({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  product: { id: number; handle: string; title: string };
}) {
  const toast = useToast();
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [storeId, setStoreId] = useState<number | "">("");
  const [externalId, setExternalId] = useState<string>("");
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

  // 关闭时清空一次性输入，避免下次打开还残留上次的值。
  useEffect(() => {
    if (!open) {
      setStoreId("");
      setExternalId("");
    }
  }, [open]);

  async function submit() {
    if (!storeId) {
      toast.warn("请先选择目标店铺");
      return;
    }
    const trimmed = externalId.trim();
    if (!trimmed) {
      toast.warn("请填写产品在 Shopify 的 ID");
      return;
    }
    const store = stores.find((s) => s.id === storeId);
    if (!store) {
      toast.error("店铺不存在");
      return;
    }
    // 后端返回的 StoreItem 当前类型未枚举 tenantId；缺失时回退到 1（与旧 prompt 行为一致）。
    const tenantId = store.tenantId ?? 1;
    setSubmitting(true);
    try {
      const r = await productSnapshotApi.manual(Number(storeId), trimmed, tenantId);
      if (r.queued) {
        toast.success(`快照已入队 (snapshotId=${r.snapshotId})`);
      } else {
        toast.info("5 分钟内已有快照任务，跳过");
      }
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
      title="立即触发产品快照"
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
        产品：<span className="font-mono text-xs">{product.handle}</span> · {product.title}
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
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Shopify 产品 ID（external_id）
        </label>
        <input
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="例如 9876543210 或 gid://shopify/Product/..."
          className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          未来本字段将自动从 store_product 映射回填，目前需手填。
        </p>
      </div>
    </Dialog>
  );
}
