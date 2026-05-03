"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  storeApi,
  type StoreItem,
  STORE_DISABLE_AVAILABLE,
  ASSET_TRIGGER_AVAILABLE,
} from "@/lib/api/store";
import { useStores, useInvalidateStores } from "@/lib/queries/stores";
import { useToast } from "@/components/ui/Toast";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "正常", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  DISABLED: { text: "已停用", cls: "bg-zinc-100 text-zinc-500 border-zinc-300" },
  TOKEN_EXPIRED: { text: "Token 已过期", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  UNINSTALLED: { text: "已卸载", cls: "bg-rose-100 text-rose-900 border-rose-300" },
};

const SENSITIVE_DISABLE = "STORE_BATCH_DISABLE";

export default function StoresPage() {
  const toast = useToast();
  const { data, isPending, error } = useStores();
  const invalidateStores = useInvalidateStores();
  const stores: StoreItem[] = data ?? [];
  const errorMsg = error ? (error as Error).message : "";

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [healthChecking, setHealthChecking] = useState<Record<number, boolean>>({});

  const allSelected = useMemo(
    () => stores.length > 0 && stores.every((s) => selected.has(s.id)),
    [stores, selected]
  );
  const someSelected = useMemo(
    () => stores.some((s) => selected.has(s.id)) && !allSelected,
    [stores, selected, allSelected]
  );

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(stores.map((s) => s.id)));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onHealthCheck(id: number) {
    setHealthChecking((m) => ({ ...m, [id]: true }));
    try {
      const r = await storeApi.healthCheck(id);
      if (r.ok) {
        toast.success(`#${id} 店铺正常`);
      } else {
        toast.error(`#${id} 异常：${r.message ?? "未知错误"}`);
      }
      invalidateStores();
    } finally {
      setHealthChecking((m) => ({ ...m, [id]: false }));
    }
  }

  async function onBatchPullAssets() {
    if (!ASSET_TRIGGER_AVAILABLE) {
      toast.warn("后端尚未实现「触发资产快照」endpoint");
      return;
    }
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    let done = 0;
    let failed = 0;
    try {
      for (const id of ids) {
        try {
          // 占位：未来调 assetApi.trigger(id)
          await Promise.reject(new Error("endpoint missing"));
        } catch {
          failed++;
        } finally {
          done++;
          toast.info(`${done}/${ids.length} 完成`);
        }
      }
      if (failed > 0) toast.error(`${failed} 个店铺失败`);
      else toast.success("批量拉资产完成");
    } finally {
      setBusy(false);
    }
  }

  async function onBatchDisable() {
    if (!STORE_DISABLE_AVAILABLE) {
      toast.warn("后端尚未实现 POST /store/{id}/disable endpoint");
      return;
    }
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`确认禁用选中的 ${ids.length} 个店铺？此操作需钉钉 6 位码二次确认。`)) {
      return;
    }
    setBusy(true);
    try {
      await storeApi.requestSensitiveCode(SENSITIVE_DISABLE);
      const code = window.prompt("钉钉收到的 6 位验证码：");
      if (!code) {
        toast.info("已取消");
        return;
      }
      const { sensitiveToken } = await storeApi.verifySensitive(SENSITIVE_DISABLE, code);
      let done = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          await storeApi.disable(id, sensitiveToken);
        } catch {
          failed++;
        } finally {
          done++;
          toast.info(`${done}/${ids.length} 完成`);
        }
      }
      if (failed > 0) toast.error(`${failed} 个店铺失败`);
      else toast.success("批量禁用完成");
      setSelected(new Set());
      invalidateStores();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">店铺管理</h1>
        <Link
          href="/stores/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          + 接入店铺
        </Link>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
        <div className="text-muted-foreground">
          {selectedCount > 0 ? `已选 ${selectedCount} 项` : "未选择"}
        </div>
        <DropdownMenu
          align="right"
          trigger={
            <button
              type="button"
              disabled={selectedCount === 0 || busy}
              className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              批量操作 ▾
            </button>
          }
        >
          <DropdownItem
            disabled={!ASSET_TRIGGER_AVAILABLE || busy}
            onClick={onBatchPullAssets}
          >
            批量拉资产
            {!ASSET_TRIGGER_AVAILABLE && (
              <span className="ml-1 text-[10px] text-muted-foreground">(待后端)</span>
            )}
          </DropdownItem>
          <DropdownItem
            variant="destructive"
            disabled={!STORE_DISABLE_AVAILABLE || busy}
            onClick={onBatchDisable}
          >
            批量禁用
            {!STORE_DISABLE_AVAILABLE && (
              <span className="ml-1 text-[10px] opacity-70">(待后端)</span>
            )}
          </DropdownItem>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label="全选"
                />
              </th>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">店铺域名</th>
              <th className="px-3 py-2 text-left">品牌名</th>
              <th className="px-3 py-2 text-left">Token 类型</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">接入时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">加载中...</td></tr>
            )}
            {!isPending && stores.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">暂无店铺，点右上角接入</td></tr>
            )}
            {stores.map((s) => {
              const sl = STATUS_LABEL[s.status] ?? STATUS_LABEL.DISABLED;
              const checked = selected.has(s.id);
              return (
                <tr key={s.id} className={"border-t " + (checked ? "bg-blue-50/40" : "")}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(s.id)}
                      aria-label={`选择 ${s.myshopifyDomain}`}
                    />
                  </td>
                  <td className="px-3 py-2">{s.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.myshopifyDomain}</td>
                  <td className="px-3 py-2">{s.brandName || "-"}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="rounded border px-1.5 py-0.5 font-mono">{s.tokenType}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={"inline-block rounded border px-2 py-0.5 text-xs " + sl.cls}>
                      {sl.text}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={!!healthChecking[s.id]}
                      onClick={() => onHealthCheck(s.id)}
                      className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                      title="健康检查（兜底：基于 list 状态判断）"
                    >
                      {healthChecking[s.id] ? "检查中…" : "健康检查"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
