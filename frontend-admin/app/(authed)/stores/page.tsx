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
import { useI18n } from "@/lib/i18n/context";

const STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-900 border-emerald-300",
  DISABLED: "bg-zinc-100 text-zinc-500 border-zinc-300",
  TOKEN_EXPIRED: "bg-amber-100 text-amber-900 border-amber-300",
  UNINSTALLED: "bg-rose-100 text-rose-900 border-rose-300",
};

const SENSITIVE_DISABLE = "STORE_BATCH_DISABLE";

export default function StoresPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, isPending, error } = useStores();
  const invalidateStores = useInvalidateStores();
  const stores: StoreItem[] = data ?? [];
  const errorMsg = error ? (error as Error).message : "";

  const STATUS_TEXT: Record<string, string> = {
    ACTIVE: t("stores.status.active"),
    DISABLED: t("stores.status.disabled"),
    TOKEN_EXPIRED: t("stores.status.tokenExpired"),
    UNINSTALLED: t("stores.status.uninstalled"),
  };

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
        toast.success(t("stores.healthOk").replace("{id}", String(id)));
      } else {
        toast.error(
          t("stores.healthFail")
            .replace("{id}", String(id))
            .replace("{message}", r.message ?? t("stores.healthUnknown"))
        );
      }
      invalidateStores();
    } finally {
      setHealthChecking((m) => ({ ...m, [id]: false }));
    }
  }

  async function onBatchPullAssets() {
    if (!ASSET_TRIGGER_AVAILABLE) {
      toast.warn(t("stores.assetsNotImpl"));
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
          toast.info(
            t("stores.batchProgress")
              .replace("{done}", String(done))
              .replace("{total}", String(ids.length))
          );
        }
      }
      if (failed > 0) toast.error(t("stores.batchFailed").replace("{count}", String(failed)));
      else toast.success(t("stores.batchPullDone"));
    } finally {
      setBusy(false);
    }
  }

  async function onBatchDisable() {
    if (!STORE_DISABLE_AVAILABLE) {
      toast.warn(t("stores.disableNotImpl"));
      return;
    }
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(t("stores.confirmDisable").replace("{count}", String(ids.length)))) {
      return;
    }
    setBusy(true);
    try {
      await storeApi.requestSensitiveCode(SENSITIVE_DISABLE);
      const code = window.prompt(t("stores.dingCodePrompt"));
      if (!code) {
        toast.info(t("stores.cancelled"));
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
          toast.info(
            t("stores.batchProgress")
              .replace("{done}", String(done))
              .replace("{total}", String(ids.length))
          );
        }
      }
      if (failed > 0) toast.error(t("stores.batchFailed").replace("{count}", String(failed)));
      else toast.success(t("stores.batchDisableDone"));
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
        <h1 className="text-2xl font-semibold">{t("stores.title")}</h1>
        <Link
          href="/stores/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {t("stores.create")}
        </Link>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
        <div className="text-muted-foreground">
          {selectedCount > 0
            ? t("stores.selected").replace("{count}", String(selectedCount))
            : t("stores.unselected")}
        </div>
        <DropdownMenu
          align="right"
          trigger={
            <button
              type="button"
              disabled={selectedCount === 0 || busy}
              className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("stores.batchMenu")}
            </button>
          }
        >
          <DropdownItem
            disabled={!ASSET_TRIGGER_AVAILABLE || busy}
            onClick={onBatchPullAssets}
          >
            {t("stores.batch.pullAssets")}
            {!ASSET_TRIGGER_AVAILABLE && (
              <span className="ml-1 text-[10px] text-muted-foreground">{t("stores.pendingBackend")}</span>
            )}
          </DropdownItem>
          <DropdownItem
            variant="destructive"
            disabled={!STORE_DISABLE_AVAILABLE || busy}
            onClick={onBatchDisable}
          >
            {t("stores.batch.disable")}
            {!STORE_DISABLE_AVAILABLE && (
              <span className="ml-1 text-[10px] opacity-70">{t("stores.pendingBackend")}</span>
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
                  aria-label={t("stores.selectAll")}
                />
              </th>
              <th className="px-3 py-2 text-left">{t("stores.column.id")}</th>
              <th className="px-3 py-2 text-left">{t("stores.column.domain")}</th>
              <th className="px-3 py-2 text-left">{t("stores.column.brand")}</th>
              <th className="px-3 py-2 text-left">{t("stores.column.tokenType")}</th>
              <th className="px-3 py-2 text-left">{t("stores.column.status")}</th>
              <th className="px-3 py-2 text-left">{t("stores.column.created")}</th>
              <th className="px-3 py-2 text-right">{t("stores.column.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">{t("common.loading")}</td></tr>
            )}
            {!isPending && stores.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">{t("stores.empty")}</td></tr>
            )}
            {stores.map((s) => {
              const cls = STATUS_CLS[s.status] ?? STATUS_CLS.DISABLED;
              const text = STATUS_TEXT[s.status] ?? STATUS_TEXT.DISABLED;
              const checked = selected.has(s.id);
              return (
                <tr key={s.id} className={"border-t " + (checked ? "bg-blue-50/40" : "")}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(s.id)}
                      aria-label={t("stores.selectRow").replace("{domain}", s.myshopifyDomain)}
                    />
                  </td>
                  <td className="px-3 py-2">{s.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.myshopifyDomain}</td>
                  <td className="px-3 py-2">{s.brandName || "-"}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="rounded border px-1.5 py-0.5 font-mono">{s.tokenType}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}>
                      {text}
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
                      title={t("stores.healthCheckTip")}
                    >
                      {healthChecking[s.id] ? t("stores.healthChecking") : t("stores.healthCheck")}
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
