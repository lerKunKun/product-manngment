"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/StatusBlocks";
import { storeApi, type StoreItem } from "@/lib/api/store";
import { productSnapshotApi } from "@/lib/api/snapshot";
import {
  storeProductApi,
  type StoreProductMapping,
} from "@/lib/api/storeProduct";

/**
 * 立即触发产品快照（替换原 prompt() UI）。
 *
 * 设计：
 *  - 只展示**该产品已成功 push 过、能在 Shopify 端拉到**的店铺。判定方式：
 *    store_product 映射 + shopifyProductId 非空。没 push 过的店铺压根不出现
 *    在下拉里，避免用户手填错值导致后端反查失败 → product_id 入库 NULL。
 *  - external_id 直接从映射读出，input 只读展示。
 *  - 提交时同时把本平台 product.id 透传给后端，让 product_snapshot.product_id
 *    一定能正确落库。
 *  - 没任何映射时空态提示 "该产品尚未推送到任何店铺"。
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
  // stores 列表只用于查 tenantId（mappings 没带 tenantId 字段）
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [mappings, setMappings] = useState<StoreProductMapping[]>([]);
  const [storeId, setStoreId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      storeApi.list().catch(() => [] as StoreItem[]),
      storeProductApi.listForProduct(product.id).catch(() => [] as StoreProductMapping[]),
    ])
      .then(([s, m]) => {
        setStores(s ?? []);
        setMappings(m ?? []);
      })
      .finally(() => setLoading(false));
  }, [open, product.id]);

  useEffect(() => {
    if (!open) {
      setStoreId("");
      setMappings([]);
    }
  }, [open]);

  // 只保留"已 push 成功"的映射：必须有 shopifyProductId（push 完成后才回填）
  const eligibleMappings = useMemo(
    () =>
      mappings.filter(
        (m) => m.shopifyProductId != null && m.shopifyProductId.trim() !== ""
      ),
    [mappings]
  );
  const selectedMapping = useMemo(
    () => (storeId ? eligibleMappings.find((m) => m.storeId === storeId) : undefined),
    [storeId, eligibleMappings]
  );

  async function submit() {
    if (!selectedMapping) {
      toast.warn("请先选择目标店铺");
      return;
    }
    const externalId = selectedMapping.shopifyProductId!.trim();
    const store = stores.find((s) => s.id === selectedMapping.storeId);
    // 后端返回的 StoreItem 类型未枚举 tenantId；缺失回退到 1（与旧 prompt 行为一致）
    const tenantId = store?.tenantId ?? 1;

    setSubmitting(true);
    try {
      const r = await productSnapshotApi.manual(
        selectedMapping.storeId,
        externalId,
        tenantId,
        product.id // 关键：让后端直接落 product_snapshot.product_id
      );
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
            disabled={submitting || !selectedMapping}
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
        {loading ? (
          <Spinner />
        ) : eligibleMappings.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            该产品尚未推送到任何店铺。先在产品详情顶部「推送」到至少一家店铺后再来触发快照。
          </p>
        ) : (
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value ? Number(e.target.value) : "")}
            className="w-full rounded-md border bg-background px-2 py-1.5"
          >
            <option value="">— 请选择 —</option>
            {eligibleMappings.map((m) => (
              <option key={m.storeId} value={m.storeId}>
                {(m.storeBrand ?? m.storeDomain ?? `Store #${m.storeId}`)}
                {m.storeDomain ? ` (${m.storeDomain})` : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      {selectedMapping && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Shopify 产品 ID（external_id）
          </label>
          <input
            value={selectedMapping.shopifyProductId ?? ""}
            readOnly
            className="w-full rounded-md border bg-muted/30 px-2 py-1.5 font-mono text-xs text-muted-foreground"
          />
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3 w-3 text-emerald-600" />
            自该店铺的 store_product 映射读取
            {selectedMapping.lastPushedAt && (
              <>
                ；上次推送：
                {new Date(selectedMapping.lastPushedAt).toLocaleString("zh-CN")}
              </>
            )}
          </p>
        </div>
      )}
    </Dialog>
  );
}
