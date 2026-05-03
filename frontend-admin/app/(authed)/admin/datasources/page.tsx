"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  LoadingBlock,
  EmptyState,
  ErrorBanner,
  Spinner,
} from "@/components/ui/StatusBlocks";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Form, FormField } from "@/components/ui/Form";
import {
  datasourceApi,
  datasourceAdminApi,
  type ReloadResult,
  type SysTenantDatasource,
  type RegisterDatasourceReq,
} from "@/lib/api/datasource";
import type { ApiError } from "@/lib/api/client";

const SENSITIVE_ACTION = "DATASOURCE_REGISTER";

/** url 脱敏：mysql://user:pass@host:port/db → mysql://***@host:port/db。 */
function maskUrl(url: string) {
  return url.replace(/\/\/[^@]*@/, "//***@");
}

function isPlatformRow(row: SysTenantDatasource) {
  return row.tenantCode === "platform";
}

type CreateForm = {
  tenantId: string;
  tenantCode: string;
  jdbcUrl: string;
  username: string;
  password: string;
  poolMin: string;
  poolMax: string;
};

const EMPTY_FORM: CreateForm = {
  tenantId: "",
  tenantCode: "",
  jdbcUrl: "",
  username: "",
  password: "",
  poolMin: "5",
  poolMax: "20",
};

export default function DatasourcesPage() {
  const toast = useToast();

  const [rows, setRows] = useState<SysTenantDatasource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloading, setReloading] = useState(false);

  // 注册对话框
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formErr, setFormErr] = useState<Partial<Record<keyof CreateForm, string>>>({});
  const [createStep, setCreateStep] = useState<"form" | "code">("form");
  const [createCode, setCreateCode] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  // 删除对话框
  const [removeTarget, setRemoveTarget] = useState<SysTenantDatasource | null>(null);
  const [removeStep, setRemoveStep] = useState<"confirm" | "code">("confirm");
  const [removeCode, setRemoveCode] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await datasourceAdminApi.list();
      setRows(list ?? []);
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

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormErr({});
    setCreateStep("form");
    setCreateCode("");
    setCreateOpen(true);
  }

  function validateForm(): boolean {
    const err: Partial<Record<keyof CreateForm, string>> = {};
    const tid = Number(form.tenantId);
    if (!form.tenantId.trim() || !Number.isFinite(tid) || tid <= 0)
      err.tenantId = "请填写有效的 tenantId";
    if (!form.tenantCode.trim()) err.tenantCode = "tenantCode 必填";
    if (!form.jdbcUrl.trim()) err.jdbcUrl = "jdbcUrl 必填";
    if (!form.username.trim()) err.username = "username 必填";
    if (!form.password) err.password = "password 必填";
    const pmin = Number(form.poolMin);
    const pmax = Number(form.poolMax);
    if (form.poolMin && (!Number.isFinite(pmin) || pmin < 0)) err.poolMin = "poolMin 必须 ≥ 0";
    if (form.poolMax && (!Number.isFinite(pmax) || pmax <= 0)) err.poolMax = "poolMax 必须 > 0";
    if (form.poolMin && form.poolMax && pmin > pmax) err.poolMax = "poolMax 不能小于 poolMin";
    setFormErr(err);
    return Object.keys(err).length === 0;
  }

  async function onSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;
    setCreateBusy(true);
    try {
      await datasourceAdminApi.requestSensitiveCode(SENSITIVE_ACTION);
      toast.info("验证码已发送到钉钉");
      setCreateStep("code");
    } catch {
      /* 全局 toast 已提示 */
    } finally {
      setCreateBusy(false);
    }
  }

  async function onConfirmCreate() {
    if (createCode.trim().length !== 6) {
      toast.warn("请输入 6 位验证码");
      return;
    }
    setCreateBusy(true);
    try {
      const { sensitiveToken } = await datasourceAdminApi.verifySensitive(
        SENSITIVE_ACTION,
        createCode.trim()
      );
      const body: RegisterDatasourceReq = {
        tenantId: Number(form.tenantId),
        tenantCode: form.tenantCode.trim(),
        jdbcUrl: form.jdbcUrl.trim(),
        username: form.username.trim(),
        password: form.password,
        poolMin: form.poolMin ? Number(form.poolMin) : undefined,
        poolMax: form.poolMax ? Number(form.poolMax) : undefined,
      };
      const id = await datasourceAdminApi.create(body, sensitiveToken);
      toast.success(`已注册数据源 id=${id}`);
      setCreateOpen(false);
      load();
    } catch {
      /* 全局 toast 已提示 */
    } finally {
      setCreateBusy(false);
    }
  }

  function openRemove(row: SysTenantDatasource) {
    setRemoveTarget(row);
    setRemoveStep("confirm");
    setRemoveCode("");
  }

  async function onRequestRemoveCode() {
    setRemoveBusy(true);
    try {
      await datasourceAdminApi.requestSensitiveCode(SENSITIVE_ACTION);
      toast.info("验证码已发送到钉钉");
      setRemoveStep("code");
    } catch {
      /* 全局 toast 已提示 */
    } finally {
      setRemoveBusy(false);
    }
  }

  async function onConfirmRemove() {
    if (!removeTarget) return;
    if (removeCode.trim().length !== 6) {
      toast.warn("请输入 6 位验证码");
      return;
    }
    setRemoveBusy(true);
    try {
      const { sensitiveToken } = await datasourceAdminApi.verifySensitive(
        SENSITIVE_ACTION,
        removeCode.trim()
      );
      await datasourceAdminApi.remove(removeTarget.id, sensitiveToken);
      toast.success(`已删除数据源 id=${removeTarget.id}`);
      setRemoveTarget(null);
      load();
    } catch {
      /* 全局 toast 已提示 */
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">多数据源管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理 sys_tenant_datasource 配置：注册新租户、调整连接池参数、软删除（status=DISABLED）。
            密码以 AES-GCM 加密存储，列表中以 <code className="rounded bg-muted px-1 py-0.5 text-[11px]">****</code> 占位。
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
            onClick={openCreate}
            className="rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            + 注册新租户
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">tenantCode</th>
                <th className="px-3 py-2 text-left">tenantId</th>
                <th className="px-3 py-2 text-left">jdbcUrl</th>
                <th className="px-3 py-2 text-left">username</th>
                <th className="px-3 py-2 text-left">pool</th>
                <th className="px-3 py-2 text-left">status</th>
                <th className="px-3 py-2 text-left">createdAt</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8}>
                    <LoadingBlock />
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-2">
                    <EmptyState
                      title="尚未配置任何租户数据源"
                      hint="点击「+ 注册新租户」录入配置"
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => {
                  const isPlatform = isPlatformRow(r);
                  return (
                    <tr key={r.id} className="border-t hover:bg-accent/40">
                      <td className="px-3 py-2 font-medium">
                        {r.tenantCode ?? "-"}
                        {isPlatform && (
                          <Badge className="ml-1" variant="info">
                            platform
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.tenantId}</td>
                      <td className="px-3 py-2 font-mono text-xs">{maskUrl(r.jdbcUrl ?? "")}</td>
                      <td className="px-3 py-2">{r.username}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {(r.poolMin ?? "-") + " / " + (r.poolMax ?? "-")}
                      </td>
                      <td className="px-3 py-2">
                        {r.status === "ACTIVE" ? (
                          <Badge variant="success">ACTIVE</Badge>
                        ) : (
                          <Badge variant="neutral">DISABLED</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : "-"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={isPlatform}
                          onClick={() => openRemove(r)}
                          className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
                          title={isPlatform ? "platform 主库不可删除" : ""}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        提示：注册成功后会自动尝试 register(tenantId)；若 sys_tenant 中尚未建立 ACTIVE 行，可在补齐后再点
        「Reload 路由」让连接池生效。
      </p>

      {/* 注册对话框 */}
      <Dialog
        open={createOpen}
        onClose={() => (createBusy ? null : setCreateOpen(false))}
        title={createStep === "form" ? "注册新租户数据源" : "钉钉验证码确认"}
        footer={
          createStep === "form" ? (
            <>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={createBusy}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => onSubmitForm({ preventDefault: () => {} } as React.FormEvent)}
                disabled={createBusy}
                className="inline-flex items-center rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {createBusy && <Spinner className="mr-1" />}下一步：发送验证码
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCreateStep("form")}
                disabled={createBusy}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              >
                返回
              </button>
              <button
                type="button"
                onClick={onConfirmCreate}
                disabled={createBusy}
                className="inline-flex items-center rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {createBusy && <Spinner className="mr-1" />}确认注册
              </button>
            </>
          )
        }
      >
        {createStep === "form" ? (
          <Form onSubmit={onSubmitForm}>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="tenantId" required error={formErr.tenantId} htmlFor="ds-tid">
                <input
                  id="ds-tid"
                  type="number"
                  min={1}
                  value={form.tenantId}
                  onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
                  placeholder="1001"
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </FormField>
              <FormField label="tenantCode" required error={formErr.tenantCode} htmlFor="ds-tcode">
                <input
                  id="ds-tcode"
                  value={form.tenantCode}
                  onChange={(e) => setForm({ ...form, tenantCode: e.target.value })}
                  placeholder="tenant_xx"
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </FormField>
            </div>
            <FormField label="jdbcUrl" required error={formErr.jdbcUrl} htmlFor="ds-url">
              <input
                id="ds-url"
                value={form.jdbcUrl}
                onChange={(e) => setForm({ ...form, jdbcUrl: e.target.value })}
                placeholder="jdbc:mysql://host:3306/tenant_xx"
                className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="username" required error={formErr.username} htmlFor="ds-user">
                <input
                  id="ds-user"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </FormField>
              <FormField label="password" required error={formErr.password} htmlFor="ds-pwd">
                <input
                  id="ds-pwd"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="poolMin" error={formErr.poolMin} htmlFor="ds-pmin">
                <input
                  id="ds-pmin"
                  type="number"
                  min={0}
                  value={form.poolMin}
                  onChange={(e) => setForm({ ...form, poolMin: e.target.value })}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </FormField>
              <FormField label="poolMax" error={formErr.poolMax} htmlFor="ds-pmax">
                <input
                  id="ds-pmax"
                  type="number"
                  min={1}
                  value={form.poolMax}
                  onChange={(e) => setForm({ ...form, poolMax: e.target.value })}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              </FormField>
            </div>
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              密码将以 AES-GCM 加密后入库；后端列表接口永远返回 ****，不会回传明文。
            </p>
          </Form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              即将注册租户 <span className="font-medium">{form.tenantCode}</span>（tenantId={form.tenantId}）。
            </p>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">钉钉收到的 6 位验证码</label>
              <input
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6 位数字"
                inputMode="numeric"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm tracking-widest"
                autoFocus
              />
            </div>
          </div>
        )}
      </Dialog>

      {/* 删除对话框 */}
      <Dialog
        open={!!removeTarget}
        onClose={() => (removeBusy ? null : setRemoveTarget(null))}
        title={removeStep === "confirm" ? "删除数据源" : "钉钉验证码确认"}
        footer={
          removeStep === "confirm" ? (
            <>
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                disabled={removeBusy}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onRequestRemoveCode}
                disabled={removeBusy}
                className="inline-flex items-center rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {removeBusy && <Spinner className="mr-1" />}下一步：发送验证码
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setRemoveStep("confirm")}
                disabled={removeBusy}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              >
                返回
              </button>
              <button
                type="button"
                onClick={onConfirmRemove}
                disabled={removeBusy}
                className="inline-flex items-center rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {removeBusy && <Spinner className="mr-1" />}确认删除
              </button>
            </>
          )
        }
      >
        {removeStep === "confirm" ? (
          <p className="text-sm">
            将把数据源{" "}
            <span className="font-medium">
              {removeTarget?.tenantCode ?? `id=${removeTarget?.id}`}
            </span>{" "}
            标记为 DISABLED 并从动态路由表中移除。可通过修改 status 恢复。
          </p>
        ) : (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">钉钉收到的 6 位验证码</label>
            <input
              value={removeCode}
              onChange={(e) => setRemoveCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6 位数字"
              inputMode="numeric"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm tracking-widest"
              autoFocus
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
