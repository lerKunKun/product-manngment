"use client";

/**
 * 员工管理（Admin）。
 *
 * 功能：
 *  - 列表（搜索 + 状态/类型/部门筛选 + 分页）
 *  - 新建 / 编辑（弹 Dialog）
 *  - 单条：编辑 / 重置密码（敏感）/ 冻结·解冻 / 删除 / Impersonate（敏感）
 *  - 批量：改部门 / 改角色 / 冻结·解冻
 *
 * 敏感操作（重置密码 / Impersonate）流程：
 *   1) authApi 共享端点 /auth/sensitive/request → 钉钉收到 6 位码
 *   2) /auth/sensitive/verify → X-Sensitive-Token
 *   3) 调真正的接口（带 X-Sensitive-Token）
 *
 * 临时凑合（W1 期）：6 位码用 window.prompt 收集，等 SensitiveActionDialog
 *   组件就绪（E1 agent 提供）后替换为完整对话框。TODO 见 promptCode。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Pagination } from "@/components/ui/Pagination";
import {
  ErrorBanner,
  LoadingBlock,
  EmptyState,
  Spinner,
} from "@/components/ui/StatusBlocks";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/context";
import { type ApiError } from "@/lib/api/client";
import {
  userAdminApi,
  type AdminUserListItem,
  type CreateUserReq,
  type UpdateUserReq,
} from "@/lib/api/userAdmin";
import type { SysOrg } from "@/lib/api/org";
import type { SysRole } from "@/lib/api/role";

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ["ACTIVE", "FROZEN", "EXPIRED"] as const;
const USERTYPE_OPTIONS = ["STAFF", "TEMP"] as const;

/**
 * 临时验证码采集：window.prompt(message)。
 * TODO（E1 agent 完成 SensitiveActionDialog 后替换）。
 */
function promptCode(message: string): string | null {
  if (typeof window === "undefined") return null;
  const v = window.prompt(message);
  if (v == null) return null;
  const trimmed = v.trim();
  if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** 二次确认 + 钉钉验证码 → 回 X-Sensitive-Token；失败抛 null。 */
async function requireSensitiveToken(
  action: string,
  promptMsg: string,
  toast: ReturnType<typeof useToast>,
  codeSentMsg: string
): Promise<string | null> {
  try {
    await userAdminApi.requestSensitiveCode(action);
    toast.info(codeSentMsg);
  } catch {
    return null; // toast 已上报
  }
  const code = promptCode(promptMsg);
  if (!code) {
    toast.warn("请输入 6 位数字验证码");
    return null;
  }
  try {
    const { sensitiveToken } = await userAdminApi.verifySensitive(action, code);
    return sensitiveToken;
  } catch {
    return null;
  }
}

export default function UsersAdminPage() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const beginImpersonation = useAuthStore((s) => s.beginImpersonation);

  // ---- query ----
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>("");
  const [userType, setUserType] = useState<string>("");
  const [deptId, setDeptId] = useState<number | "">("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<{
    records: AdminUserListItem[];
    total: number;
  }>({ records: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [meta, setMeta] = useState<{ roles: SysRole[]; orgs: SysOrg[] }>({
    roles: [],
    orgs: [],
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<AdminUserListItem | null>(null);
  const [creating, setCreating] = useState(false);

  // ---- load ----
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await userAdminApi.list({
        keyword: keyword.trim() || undefined,
        status: status || undefined,
        userType: userType || undefined,
        deptId: deptId === "" ? undefined : deptId,
        page,
        size: PAGE_SIZE,
      });
      setData({ records: resp.records ?? [], total: resp.total ?? 0 });
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [keyword, status, userType, deptId, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([userAdminApi.meta.roles(), userAdminApi.meta.orgs()])
      .then(([roles, orgs]) => setMeta({ roles, orgs }))
      .catch(() => {
        /* toast 已上报 */
      });
  }, []);

  // depts only（按 type=DEPT 过滤；COMPANY 暂不当部门用）
  const depts = useMemo(
    () => meta.orgs.filter((o) => (o.type ?? "DEPT") === "DEPT"),
    [meta.orgs]
  );

  function onSearch() {
    setPage(1);
    load();
  }

  function toggleSelect(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((s) => {
      if (s.size === data.records.length) return new Set();
      return new Set(data.records.map((r) => r.id));
    });
  }

  // ---- single-row actions ----
  async function onFreeze(u: AdminUserListItem, freeze: boolean) {
    const msg = freeze
      ? t("users.admin.confirm.freeze").replace("{name}", u.username)
      : t("users.admin.confirm.unfreeze").replace("{name}", u.username);
    if (!window.confirm(msg)) return;
    try {
      if (freeze) await userAdminApi.freeze(u.id);
      else await userAdminApi.unfreeze(u.id);
      toast.success(
        freeze ? t("users.admin.toast.frozen") : t("users.admin.toast.unfrozen")
      );
      load();
    } catch {
      /* toast 已上报 */
    }
  }

  async function onDelete(u: AdminUserListItem) {
    if (!window.confirm(t("users.admin.confirm.delete").replace("{name}", u.username))) return;
    try {
      await userAdminApi.remove(u.id);
      toast.success(t("users.admin.toast.deleted"));
      load();
    } catch {
      /* toast 已上报 */
    }
  }

  async function onResetPassword(u: AdminUserListItem) {
    const tokenStr = await requireSensitiveToken(
      "USER_RESET_PASSWORD",
      t("users.admin.resetPassword.codePrompt"),
      toast,
      t("users.admin.toast.codeSent")
    );
    if (!tokenStr) return;
    try {
      const { temporaryPassword } = await userAdminApi.resetPassword(u.id, tokenStr);
      window.alert(
        t("users.admin.resetPassword.result").replace("{pwd}", temporaryPassword)
      );
    } catch {
      /* toast 已上报 */
    }
  }

  async function onImpersonate(u: AdminUserListItem) {
    if (!window.confirm(t("users.admin.impersonate.confirm").replace("{name}", u.username))) return;
    const tokenStr = await requireSensitiveToken(
      "IMPERSONATE_USER",
      t("users.admin.impersonate.codePrompt"),
      toast,
      t("users.admin.toast.codeSent")
    );
    if (!tokenStr) return;
    try {
      const resp = await userAdminApi.impersonate(u.id, tokenStr);
      beginImpersonation(
        { userId: resp.targetUserId, username: resp.targetUsername },
        resp.accessToken,
        resp.expiresInSeconds
      );
      toast.success(
        t("users.admin.impersonate.success").replace("{name}", resp.targetUsername)
      );
      router.push("/dashboard");
    } catch {
      /* toast 已上报 */
    }
  }

  // ---- batch ----
  async function onBatchDept() {
    if (selected.size === 0) return;
    const v = window.prompt("目标部门 ID（数字）：");
    if (!v) return;
    const did = Number(v);
    if (!Number.isFinite(did) || did <= 0) {
      toast.warn("部门 ID 不合法");
      return;
    }
    try {
      const { affected } = await userAdminApi.batchUpdateDept(
        Array.from(selected),
        did
      );
      toast.success(t("users.admin.toast.batchOk").replace("{affected}", String(affected)));
      setSelected(new Set());
      load();
    } catch {
      /* toast 已上报 */
    }
  }
  async function onBatchRoles() {
    if (selected.size === 0) return;
    const v = window.prompt(
      "目标角色 ID（多个用 , 分隔；置空表示移除全部）："
    );
    if (v == null) return;
    const ids = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    try {
      const { affected } = await userAdminApi.batchUpdateRoles(Array.from(selected), ids);
      toast.success(t("users.admin.toast.batchOk").replace("{affected}", String(affected)));
      setSelected(new Set());
      load();
    } catch {
      /* toast 已上报 */
    }
  }
  async function onBatchFreeze(freeze: boolean) {
    if (selected.size === 0) return;
    const verb = freeze ? "冻结" : "解冻";
    if (!window.confirm(`确定批量${verb} ${selected.size} 名员工？`)) return;
    try {
      const { affected } = await userAdminApi.batchFreeze(Array.from(selected), freeze);
      toast.success(t("users.admin.toast.batchOk").replace("{affected}", String(affected)));
      setSelected(new Set());
      load();
    } catch {
      /* toast 已上报 */
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("users.admin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("users.admin.description")}
        </p>
      </div>

      {/* 搜索 / 筛选 */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-background p-3">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            {t("users.admin.search.placeholder")}
          </span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder={t("users.admin.search.placeholder")}
            className="w-72 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            {t("users.admin.filter.status")}
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">{t("users.admin.filter.all")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`users.admin.status.${s}` as never)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            {t("users.admin.filter.userType")}
          </span>
          <select
            value={userType}
            onChange={(e) => setUserType(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">{t("users.admin.filter.all")}</option>
            {USERTYPE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`users.admin.userType.${s}` as never)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            {t("users.admin.filter.dept")}
          </span>
          <select
            value={deptId === "" ? "" : String(deptId)}
            onChange={(e) =>
              setDeptId(e.target.value ? Number(e.target.value) : "")
            }
            className="min-w-[160px] rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">{t("users.admin.filter.all")}</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}（#{d.id}）
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onSearch}
          className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent"
        >
          {t("users.admin.btn.refresh")}
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          {t("users.admin.btn.create")}
        </button>
      </div>

      {/* 批量操作条 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">
            {t("users.admin.batch.selected").replace(
              "{count}",
              String(selected.size)
            )}
          </span>
          <button
            type="button"
            onClick={onBatchDept}
            className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
          >
            {t("users.admin.batch.changeDept")}
          </button>
          <button
            type="button"
            onClick={onBatchRoles}
            className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
          >
            {t("users.admin.batch.changeRoles")}
          </button>
          <button
            type="button"
            onClick={() => onBatchFreeze(true)}
            className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
          >
            {t("users.admin.batch.freeze")}
          </button>
          <button
            type="button"
            onClick={() => onBatchFreeze(false)}
            className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
          >
            {t("users.admin.batch.unfreeze")}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
          >
            {t("users.admin.batch.clear")}
          </button>
        </div>
      )}

      <ErrorBanner message={error} onRetry={load} />

      {/* 列表 */}
      <div className="rounded-lg border bg-background">
        {loading ? (
          <LoadingBlock />
        ) : data.records.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={
                        data.records.length > 0 &&
                        selected.size === data.records.length
                      }
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-3 py-2 text-left">{t("users.admin.col.user")}</th>
                  <th className="px-3 py-2 text-left">{t("users.admin.col.contact")}</th>
                  <th className="px-3 py-2 text-left">{t("users.admin.col.dingtalk")}</th>
                  <th className="px-3 py-2 text-left">{t("users.admin.col.roles")}</th>
                  <th className="px-3 py-2 text-left">{t("users.admin.col.dept")}</th>
                  <th className="px-3 py-2 text-left">{t("users.admin.col.status")}</th>
                  <th className="px-3 py-2 text-left">{t("users.admin.col.lastLogin")}</th>
                  <th className="px-3 py-2 text-right">{t("users.admin.col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((u) => (
                  <UserRow
                    key={u.id}
                    u={u}
                    checked={selected.has(u.id)}
                    onToggleSelect={() => toggleSelect(u.id)}
                    onEdit={() => setEditing(u)}
                    onFreeze={(freeze) => onFreeze(u, freeze)}
                    onDelete={() => onDelete(u)}
                    onResetPassword={() => onResetPassword(u)}
                    onImpersonate={() => onImpersonate(u)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 分页 */}
      {!loading && data.total > 0 && (
        <Pagination
          total={data.total}
          page={page}
          size={PAGE_SIZE}
          onChange={setPage}
        />
      )}

      {/* 新建 */}
      {creating && (
        <CreateUserDialog
          open={creating}
          onClose={() => setCreating(false)}
          roles={meta.roles}
          depts={depts}
          onCreated={() => {
            setCreating(false);
            toast.success(t("users.admin.toast.created"));
            load();
          }}
        />
      )}

      {/* 编辑 */}
      {editing && (
        <EditUserDialog
          open={!!editing}
          user={editing}
          roles={meta.roles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.success(t("users.admin.toast.updated"));
            load();
          }}
        />
      )}
    </div>
  );
}

// ===== Row =====

function UserRow({
  u,
  checked,
  onToggleSelect,
  onEdit,
  onFreeze,
  onDelete,
  onResetPassword,
  onImpersonate,
}: {
  u: AdminUserListItem;
  checked: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onFreeze: (freeze: boolean) => void;
  onDelete: () => void;
  onResetPassword: () => void;
  onImpersonate: () => void;
}) {
  const { t } = useI18n();
  const frozen = u.status === "FROZEN";
  return (
    <tr className="border-t">
      <td className="px-3 py-2 align-top">
        <input type="checkbox" checked={checked} onChange={onToggleSelect} />
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-2">
          {u.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={u.avatarUrl}
              alt=""
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
              {u.username?.slice(0, 1).toUpperCase() ?? "?"}
            </span>
          )}
          <div>
            <div className="font-medium">{u.username}</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {u.employeeNo ?? "—"}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <div>{u.email ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{u.phone ?? "—"}</div>
      </td>
      <td className="px-3 py-2 align-top">
        {u.dingtalkBound ? (
          <Badge variant="info">{t("users.admin.dingtalk.bound")}</Badge>
        ) : (
          <Badge variant="neutral">{t("users.admin.dingtalk.unbound")}</Badge>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap gap-1">
          {(u.roleNames ?? []).slice(0, 6).map((n, i) => (
            <Badge key={i} variant="neutral">
              {n}
            </Badge>
          ))}
          {(u.roleNames?.length ?? 0) === 0 && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-top">{u.deptName ?? "—"}</td>
      <td className="px-3 py-2 align-top">
        <StatusBadge status={u.status} />
        {u.userType === "TEMP" && (
          <Badge variant="warning" className="ml-1">
            {t("users.admin.userType.TEMP")}
          </Badge>
        )}
      </td>
      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}
        {u.lastLoginIp && <div className="font-mono">{u.lastLoginIp}</div>}
      </td>
      <td className="px-3 py-2 align-top text-right">
        <div className="inline-flex flex-wrap justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border bg-background px-2 py-0.5 text-xs hover:bg-accent"
          >
            {t("users.admin.btn.edit")}
          </button>
          <button
            type="button"
            onClick={onResetPassword}
            className="rounded-md border bg-background px-2 py-0.5 text-xs hover:bg-accent"
          >
            {t("users.admin.btn.resetPassword")}
          </button>
          {frozen ? (
            <button
              type="button"
              onClick={() => onFreeze(false)}
              className="rounded-md border bg-background px-2 py-0.5 text-xs hover:bg-accent"
            >
              {t("users.admin.btn.unfreeze")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onFreeze(true)}
              className="rounded-md border bg-background px-2 py-0.5 text-xs hover:bg-accent"
            >
              {t("users.admin.btn.freeze")}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-red-300 bg-background px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
          >
            {t("users.admin.btn.delete")}
          </button>
          <button
            type="button"
            onClick={onImpersonate}
            className="rounded-md border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
          >
            {t("users.admin.btn.impersonate")}
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const { t } = useI18n();
  if (!status) return <Badge variant="neutral">—</Badge>;
  const variant: "success" | "warning" | "error" | "neutral" =
    status === "ACTIVE"
      ? "success"
      : status === "FROZEN"
      ? "warning"
      : status === "EXPIRED"
      ? "error"
      : "neutral";
  return (
    <Badge variant={variant}>
      {t(`users.admin.status.${status}` as never) ?? status}
    </Badge>
  );
}

// ===== Create dialog =====

function CreateUserDialog({
  open,
  onClose,
  onCreated,
  roles,
  depts,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  roles: SysRole[];
  depts: SysOrg[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState<CreateUserReq>({
    username: "",
    employeeNo: "",
    password: "",
    email: "",
    phone: "",
    userType: "STAFF",
    position: "",
    deptId: undefined,
    roleIds: [],
    expiresAt: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      username: "",
      employeeNo: "",
      password: "",
      email: "",
      phone: "",
      userType: "STAFF",
      position: "",
      deptId: undefined,
      roleIds: [],
      expiresAt: "",
    });
    setBusy(false);
  }, [open]);

  function patch<K extends keyof CreateUserReq>(k: K, v: CreateUserReq[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.username.trim() || !form.password || form.password.length < 8) {
      toast.warn("用户名必填，密码至少 8 位");
      return;
    }
    setBusy(true);
    try {
      await userAdminApi.create({
        ...form,
        username: form.username.trim(),
        employeeNo: form.employeeNo?.trim() || undefined,
        email: form.email?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        position: form.position?.trim() || undefined,
        expiresAt:
          form.userType === "TEMP" && form.expiresAt
            ? form.expiresAt
            : undefined,
      });
      onCreated();
    } catch {
      /* toast 已上报 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("users.admin.create.title")}
      className="max-w-xl"
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
            disabled={busy}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Spinner className="mr-1" />}创建
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("users.admin.field.username")}>
          <input
            value={form.username}
            onChange={(e) => patch("username", e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label={t("users.admin.field.employeeNo")}>
          <input
            value={form.employeeNo ?? ""}
            onChange={(e) => patch("employeeNo", e.target.value)}
            placeholder="留空自动生成"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label={t("users.admin.field.password")}>
          <input
            type="password"
            value={form.password}
            onChange={(e) => patch("password", e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label={t("users.admin.field.userType")}>
          <select
            value={form.userType ?? "STAFF"}
            onChange={(e) =>
              patch("userType", e.target.value as "STAFF" | "TEMP")
            }
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="STAFF">{t("users.admin.userType.STAFF")}</option>
            <option value="TEMP">{t("users.admin.userType.TEMP")}</option>
          </select>
        </Field>
        <Field label={t("users.admin.field.email")}>
          <input
            value={form.email ?? ""}
            onChange={(e) => patch("email", e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label={t("users.admin.field.phone")}>
          <input
            value={form.phone ?? ""}
            onChange={(e) => patch("phone", e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label={t("users.admin.field.position")}>
          <input
            value={form.position ?? ""}
            onChange={(e) => patch("position", e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        {form.userType === "TEMP" && (
          <Field label={t("users.admin.field.expiresAt")}>
            <input
              type="datetime-local"
              value={form.expiresAt ?? ""}
              onChange={(e) => patch("expiresAt", e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
        )}
        <Field label={t("users.admin.field.dept")}>
          <select
            value={form.deptId == null ? "" : String(form.deptId)}
            onChange={(e) =>
              patch("deptId", e.target.value ? Number(e.target.value) : undefined)
            }
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">未指定</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}（#{d.id}）
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("users.admin.field.roles")} colSpan={2}>
          <RoleMultiSelect
            allRoles={roles}
            value={form.roleIds ?? []}
            onChange={(v) => patch("roleIds", v)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

// ===== Edit dialog =====

function EditUserDialog({
  open,
  user,
  roles,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: AdminUserListItem;
  roles: SysRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<UpdateUserReq>({
    email: user.email ?? "",
    phone: user.phone ?? "",
    position: user.position ?? "",
    avatarUrl: user.avatarUrl ?? "",
    userType: user.userType ?? "STAFF",
    expiresAt: user.expiresAt ?? "",
  });
  const [roleIds, setRoleIds] = useState<number[]>(user.roleIds ?? []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({
      email: user.email ?? "",
      phone: user.phone ?? "",
      position: user.position ?? "",
      avatarUrl: user.avatarUrl ?? "",
      userType: user.userType ?? "STAFF",
      expiresAt: user.expiresAt ?? "",
    });
    setRoleIds(user.roleIds ?? []);
  }, [user.id]);

  function patch<K extends keyof UpdateUserReq>(k: K, v: UpdateUserReq[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    setBusy(true);
    try {
      // 仅传非空字段；空字符串显式置空
      const body: UpdateUserReq = {
        email: form.email,
        phone: form.phone,
        position: form.position,
        avatarUrl: form.avatarUrl,
        userType: form.userType,
        expiresAt: form.expiresAt,
      };
      await userAdminApi.update(user.id, body);
      // roles 单独提交（替换式）
      const orig = (user.roleIds ?? []).slice().sort().join(",");
      const next = roleIds.slice().sort().join(",");
      if (orig !== next) {
        await userAdminApi.assignRoles(user.id, roleIds);
      }
      onSaved();
    } catch {
      /* toast 已上报 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${t("users.admin.edit.title")}：${user.username}`}
      className="max-w-xl"
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
            disabled={busy}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Spinner className="mr-1" />}保存
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("users.admin.field.email")}>
          <input
            value={form.email ?? ""}
            onChange={(e) => patch("email", e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label={t("users.admin.field.phone")}>
          <input
            value={form.phone ?? ""}
            onChange={(e) => patch("phone", e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label={t("users.admin.field.position")}>
          <input
            value={form.position ?? ""}
            onChange={(e) => patch("position", e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label={t("users.admin.field.userType")}>
          <select
            value={form.userType ?? "STAFF"}
            onChange={(e) =>
              patch("userType", e.target.value as "STAFF" | "TEMP")
            }
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="STAFF">{t("users.admin.userType.STAFF")}</option>
            <option value="TEMP">{t("users.admin.userType.TEMP")}</option>
          </select>
        </Field>
        {form.userType === "TEMP" && (
          <Field label={t("users.admin.field.expiresAt")}>
            <input
              type="datetime-local"
              value={
                form.expiresAt
                  ? form.expiresAt.length > 16
                    ? form.expiresAt.slice(0, 16)
                    : form.expiresAt
                  : ""
              }
              onChange={(e) => patch("expiresAt", e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
        )}
        <Field label={t("users.admin.field.roles")} colSpan={2}>
          <RoleMultiSelect
            allRoles={roles}
            value={roleIds}
            onChange={setRoleIds}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  children,
  colSpan,
}: {
  label: string;
  children: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <label className={colSpan === 2 ? "col-span-2 block" : "block"}>
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function RoleMultiSelect({
  allRoles,
  value,
  onChange,
}: {
  allRoles: SysRole[];
  value: number[];
  onChange: (v: number[]) => void;
}) {
  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {allRoles.map((r) => {
        const on = value.includes(r.id);
        return (
          <button
            type="button"
            key={r.id}
            onClick={() => toggle(r.id)}
            className={
              "rounded-md border px-2 py-1 text-xs " +
              (on
                ? "border-primary bg-primary/10"
                : "border-border bg-background hover:bg-accent")
            }
          >
            {r.name}
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              {r.code}
            </span>
          </button>
        );
      })}
      {allRoles.length === 0 && (
        <span className="text-xs text-muted-foreground">暂无可分配角色</span>
      )}
    </div>
  );
}
