"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  LoadingBlock,
  EmptyState,
  ErrorBanner,
} from "@/components/ui/StatusBlocks";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Form, FormField, FormActions } from "@/components/ui/Form";
import { datasourceApi, type ReloadResult } from "@/lib/api/datasource";
import type { ApiError } from "@/lib/api/client";

/** url 脱敏：mysql://user:pass@host:port/db → mysql://***@host:port/db。 */
function maskUrl(url: string) {
  return url.replace(/\/\/[^@]*@/, "//***@");
}

export default function DatasourcesPage() {
  const toast = useToast();

  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloading, setReloading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [tenantIdErr, setTenantIdErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await datasourceApi.list();
      setKeys(list ?? []);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onReload() {
    setReloading(true);
    try {
      const r: ReloadResult = await datasourceApi.reload();
      const parts = Object.entries(r ?? {})
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => `${k}=${v}`)
        .join("，");
      toast.success(`路由已重载${parts ? `（${parts}）` : ""}`);
      load();
    } catch {
      /* 全局 toast 已提示 */
    } finally {
      setReloading(false);
    }
  }

  function openRegister() {
    setTenantId("");
    setTenantIdErr("");
    setDialogOpen(true);
  }

  async function onSubmitRegister(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(tenantId);
    if (!tenantId.trim() || !Number.isFinite(id) || id <= 0) {
      setTenantIdErr("请填写有效的 tenantId");
      return;
    }
    setSubmitting(true);
    try {
      const ok = await datasourceApi.register(id);
      if (ok) {
        toast.success(`tenantId=${id} 数据源已注册/重载`);
        setDialogOpen(false);
        load();
      } else {
        toast.warn(`tenantId=${id} 注册失败：租户或数据源行不存在/非 ACTIVE`);
      }
    } catch {
      /* 全局 toast 已提示 */
    } finally {
      setSubmitting(false);
    }
  }

  async function onRemove(key: string) {
    if (key === "platform") {
      toast.warn("platform 主库不可注销");
      return;
    }
    if (!window.confirm(`确认注销数据源 ${key}？`)) return;
    try {
      const ok = await datasourceApi.remove(key);
      if (ok) {
        toast.success(`已注销 ${key}`);
        load();
      } else {
        toast.warn(`注销 ${key} 失败：可能未注册或为 platform`);
      }
    } catch {
      /* 全局 toast 已提示 */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">多数据源管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            查看运行时已注册的租户数据源；可整体重载路由，也可按 tenantId 单独重载或注销 key。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReload}
            disabled={reloading}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {reloading ? "重载中…" : "Reload 路由"}
          </button>
          <button
            type="button"
            onClick={openRegister}
            className="rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            + 注册新租户
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">datasource_key</th>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4}>
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-2">
                  <EmptyState
                    title="未注册任何数据源"
                    hint="点击「Reload 路由」从 sys_tenant_datasource 加载 ACTIVE 行"
                  />
                </td>
              </tr>
            )}
            {!loading &&
              keys.map((key) => {
                const isPlatform = key === "platform";
                return (
                  <tr key={key} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-xs">{key}</td>
                    <td className="px-3 py-2">
                      {isPlatform ? (
                        <Badge variant="info">platform 主库</Badge>
                      ) : (
                        <Badge variant="neutral">tenant</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="success">ACTIVE</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={isPlatform}
                        onClick={() => onRemove(key)}
                        className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
                        title={isPlatform ? "platform 主库不可注销" : ""}
                      >
                        注销
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-muted-foreground">
        提示：注册/重载操作会从 sys_tenant_datasource 表读取已加密配置，前端不直接传 url /
        密码。url 在日志中以
        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
          {maskUrl("mysql://user:pass@host:3306/db")}
        </code>
        形式脱敏。
      </p>

      <Dialog
        open={dialogOpen}
        onClose={() => (submitting ? null : setDialogOpen(false))}
        title="注册 / 重载租户数据源"
      >
        <Form onSubmit={onSubmitRegister}>
          <FormField
            label="tenantId"
            required
            htmlFor="ds-tenant-id"
            error={tenantIdErr}
            hint="后端会按 tenantId 从 sys_tenant + sys_tenant_datasource 读 ACTIVE 行注册到路由表。"
          >
            <input
              id="ds-tenant-id"
              type="number"
              inputMode="numeric"
              min={1}
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                if (tenantIdErr) setTenantIdErr("");
              }}
              placeholder="例如 1001"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              autoFocus
            />
          </FormField>

          <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            url / username / password / poolMin / poolMax 等连接参数由后端从 DB 读取（密码 AES-GCM
            加密存储），前端无法直接传入。如需新增租户配置，请先入库再来此处注册。
          </p>

          <FormActions className="justify-end">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "提交中…" : "确认注册"}
            </button>
          </FormActions>
        </Form>
      </Dialog>
    </div>
  );
}
