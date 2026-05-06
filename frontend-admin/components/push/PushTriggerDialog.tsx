"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/StatusBlocks";
import { storeApi, type StoreItem } from "@/lib/api/store";
import { pushApi } from "@/lib/api/push";
import {
  storeTemplateBindingApi,
  type StoreTemplateBinding,
} from "@/lib/api/storeTemplateBinding";
import { templateApi, type BaseTemplate, type BaseTemplateVersion } from "@/lib/api/template";
import { useAuthStore } from "@/lib/auth/store";

/**
 * 立即推送产品到 Shopify 店铺（W2-PUSH-06 + Track AS5）。
 *
 * <p>选店铺后会自动 fetch {@link storeTemplateBindingApi}.get：
 * <ul>
 *   <li>已绑定 → 显示 disabled 的版本下拉，标注"来自店铺绑定"。
 *   <li>未绑定 → 提示无绑定，本次走"无替换"或者用户点"本次覆盖"挑一个版本临时用。
 * </ul>
 * "本次覆盖"按钮解锁下拉，让用户从所有 base_template 版本里挑一条 templateVersionOverrideId
 * 一起发给后端；只对本次推送生效，不写回 binding。
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

  // Track AS5: per-store template binding + override
  const [binding, setBinding] = useState<StoreTemplateBinding | null>(null);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideId, setOverrideId] = useState<number | "">("");
  const [allTemplates, setAllTemplates] = useState<BaseTemplate[]>([]);
  const [allVersions, setAllVersions] = useState<BaseTemplateVersion[]>([]);

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
      setBinding(null);
      setOverrideEnabled(false);
      setOverrideId("");
    }
  }, [open]);

  // store 改变 → 拉 binding
  useEffect(() => {
    if (!storeId) {
      setBinding(null);
      return;
    }
    setBindingLoading(true);
    storeTemplateBindingApi
      .get(Number(storeId))
      .then((b) => setBinding(b ?? null))
      .catch(() => setBinding(null))
      .finally(() => setBindingLoading(false));
  }, [storeId]);

  // 用户启用"本次覆盖"时一次性拉所有 PUBLISHED 模板的版本，组成扁平下拉
  useEffect(() => {
    if (!overrideEnabled || allTemplates.length > 0) return;
    templateApi
      .list(1, 100, { status: "PUBLISHED" })
      .then(async (page) => {
        const tps = page.records ?? [];
        setAllTemplates(tps);
        const detailVersions = await Promise.all(
          tps.map((t) =>
            templateApi
              .detail(t.id)
              .then((d) => d.versions ?? [])
              .catch(() => []),
          ),
        );
        setAllVersions(detailVersions.flat());
      })
      .catch(() => {
        /* 全局 toast 已上报 */
      });
  }, [overrideEnabled, allTemplates.length]);

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
        templateVersionOverrideId:
          overrideEnabled && overrideId ? Number(overrideId) : null,
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

  // 当前下拉应展示的 versionId（只读：来自 binding；可写：覆盖）
  const effectiveVersionId = overrideEnabled
    ? overrideId
    : binding?.baseTemplateVersionId ?? "";

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

      {storeId && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            模板版本（替换规则来源）
          </label>
          {bindingLoading ? (
            <Spinner />
          ) : (
            <div className="space-y-1.5">
              <select
                value={effectiveVersionId}
                disabled={!overrideEnabled}
                onChange={(e) =>
                  setOverrideId(e.target.value ? Number(e.target.value) : "")
                }
                className="w-full rounded-md border bg-background px-2 py-1.5 disabled:opacity-70"
              >
                {!overrideEnabled ? (
                  binding ? (
                    <option value={binding.baseTemplateVersionId}>
                      #{binding.baseTemplateVersionId}（来自店铺绑定）
                    </option>
                  ) : (
                    <option value="">— 该店未绑定模板版本 —</option>
                  )
                ) : (
                  <>
                    <option value="">— 选一个版本 —</option>
                    {allVersions.map((v) => {
                      const t = allTemplates.find((x) => x.id === v.templateId);
                      return (
                        <option key={v.id} value={v.id}>
                          {(t?.name ?? `template#${v.templateId}`)} · {v.version} (#{v.id})
                        </option>
                      );
                    })}
                  </>
                )}
              </select>
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  setOverrideEnabled((x) => !x);
                  setOverrideId("");
                }}
              >
                {overrideEnabled ? "取消覆盖" : "本次覆盖"}
              </button>
              <p className="text-xs text-muted-foreground">
                {overrideEnabled
                  ? "本次推送将使用所选版本的默认替换规则；不会写回店铺绑定。"
                  : binding
                    ? "推送时将应用该店绑定版本的占位符替换规则。"
                    : "当前店铺未绑定模板版本；推送将不做替换。点击右上角“本次覆盖”临时挑一条版本规则。"}
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        推送会创建一条 PRODUCT_PUSH 任务；提交后跳转任务详情页，5 秒轮询一次直到完成。
      </p>
    </Dialog>
  );
}
