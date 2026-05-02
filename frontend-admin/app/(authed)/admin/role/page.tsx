"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner, ErrorBanner, EmptyState } from "@/components/ui/StatusBlocks";
import { useToast } from "@/components/ui/Toast";
import { roleApi, type SysRole, type RoleDetail } from "@/lib/api/role";
import type { ApiError } from "@/lib/api/client";

const SENSITIVE_ACTION = "ROLE_PERMISSION_CHANGE";

/** 取 module 前缀：先按 ":" 拆（PRODUCT:READ → PRODUCT），无冒号回退 "_"（USER_LIST → USER）。 */
function moduleKey(code: string): string {
  if (code.includes(":")) return code.split(":")[0];
  if (code.includes("_")) return code.split("_")[0];
  return code;
}

export default function RoleAdminPage() {
  const toast = useToast();
  const [roles, setRoles] = useState<SysRole[]>([]);
  const [details, setDetails] = useState<Record<number, RoleDetail>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    try {
      const list = await roleApi.list();
      setRoles(list);
      // 并发拉所有详情；用于聚合权限矩阵 & 拿单角色 permissionCodes
      const detailArr = await Promise.all(
        list.map((r) =>
          roleApi.get(r.id).catch(() => null as RoleDetail | null)
        )
      );
      const map: Record<number, RoleDetail> = {};
      detailArr.forEach((d, i) => {
        if (d) map[list[i].id] = d;
      });
      setDetails(map);
      if (list.length > 0 && selectedId == null) setSelectedId(list[0].id);
    } catch (e) {
      setListError((e as ApiError).message);
    } finally {
      setLoadingList(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 全部出现过的 permissionCode 集合
  const allPermissions = useMemo(() => {
    return Array.from(
      new Set(Object.values(details).flatMap((d) => d.permissionCodes ?? []))
    ).sort();
  }, [details]);

  // 按 module 分组
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const code of allPermissions) {
      const k = moduleKey(code);
      (g[k] ??= []).push(code);
    }
    return g;
  }, [allPermissions]);

  const selectedDetail = selectedId == null ? null : details[selectedId] ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">角色管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          内置角色不可改权限；自定义角色调整权限需钉钉二次确认。
        </p>
      </div>

      <ErrorBanner message={listError} onRetry={loadAll} />

      <div className="flex gap-4">
        {/* 左侧：角色列表 */}
        <aside className="w-[320px] shrink-0 rounded-lg border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">角色列表</span>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              + 新建角色
            </button>
          </div>
          <ul className="max-h-[70vh] overflow-y-auto py-1">
            {loadingList && (
              <li className="space-y-2 px-3 py-2">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </li>
            )}
            {!loadingList &&
              roles.map((r) => {
                const active = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className={
                        "block w-full px-3 py-2 text-left text-sm hover:bg-accent " +
                        (active ? "bg-primary/10" : "")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.builtin && <Badge variant="info">内置</Badge>}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {r.code}
                      </div>
                    </button>
                  </li>
                );
              })}
            {!loadingList && roles.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                暂无角色
              </li>
            )}
          </ul>
        </aside>

        {/* 右侧：详情 */}
        <section className="flex-1 min-w-0">
          {selectedId == null ? (
            <EmptyState title="请选择左侧角色" />
          ) : !selectedDetail ? (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <RoleDetailPanel
              detail={selectedDetail}
              groupedPermissions={grouped}
              onSaved={() => loadAll()}
            />
          )}
        </section>
      </div>

      {createOpen && (
        <CreateRoleDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            toast.success("角色已创建");
            setSelectedId(id);
            loadAll();
          }}
        />
      )}
    </div>
  );
}

function RoleDetailPanel({
  detail,
  groupedPermissions,
  onSaved,
}: {
  detail: RoleDetail;
  groupedPermissions: Record<string, string[]>;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { role, permissionCodes, userCount } = detail;
  const builtin = role.builtin;

  const [selected, setSelected] = useState<Set<string>>(new Set(permissionCodes));
  // 当 detail 变化（切换角色或刷新）时重置本地 draft
  useEffect(() => {
    setSelected(new Set(permissionCodes));
  }, [permissionCodes, role.id]);

  const dirty = useMemo(() => {
    if (selected.size !== permissionCodes.length) return true;
    for (const c of permissionCodes) if (!selected.has(c)) return true;
    return false;
  }, [selected, permissionCodes]);

  function toggle(code: string) {
    if (builtin) return;
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  // 权限保存：钉钉 6 位码二次确认
  const [savingDialog, setSavingDialog] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="名称" value={role.name} />
        <Card label="Code" value={<span className="font-mono text-xs">{role.code}</span>} />
        <Card
          label="类型"
          value={
            builtin ? <Badge variant="info">内置</Badge> : <Badge variant="neutral">自定义</Badge>
          }
        />
        <Card label="用户数" value={String(userCount)} />
      </div>

      {role.description && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {role.description}
        </p>
      )}

      <section className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">权限矩阵</h2>
            <span className="text-xs text-muted-foreground">
              共 {selected.size} / {Object.values(groupedPermissions).flat().length} 项
            </span>
          </div>
          {!builtin && dirty && (
            <Badge variant="warning">未保存的修改</Badge>
          )}
        </div>

        {builtin && (
          <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">
            内置角色不可修改权限
          </div>
        )}

        <div className="space-y-4 px-4 py-3">
          {Object.keys(groupedPermissions).length === 0 && (
            <p className="text-xs text-muted-foreground">暂未发现已配置的权限点</p>
          )}
          {Object.entries(groupedPermissions).map(([mod, codes]) => (
            <div key={mod}>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {mod}
              </div>
              <div className="grid grid-cols-1 gap-1 md:grid-cols-2 lg:grid-cols-3">
                {codes.map((c) => {
                  const checked = selected.has(c);
                  return (
                    <label
                      key={c}
                      className={
                        "flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs " +
                        (checked ? "border-primary/40 bg-primary/5" : "border-border") +
                        (builtin ? " cursor-not-allowed opacity-70" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        disabled={builtin}
                        checked={checked}
                        onChange={() => toggle(c)}
                      />
                      <span className="font-mono">{c}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {!builtin && (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
            <button
              type="button"
              disabled={!dirty}
              onClick={() => setSelected(new Set(permissionCodes))}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              重置
            </button>
            <button
              type="button"
              disabled={!dirty}
              onClick={() => setSavingDialog(true)}
              className={
                "rounded-md px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50 " +
                (dirty ? "bg-primary hover:opacity-90" : "bg-primary")
              }
            >
              保存权限
            </button>
          </div>
        )}
      </section>

      <BoundUsersSection roleId={role.id} />

      {savingDialog && (
        <SavePermissionDialog
          open={savingDialog}
          onClose={() => setSavingDialog(false)}
          roleId={role.id}
          codes={Array.from(selected)}
          onSaved={() => {
            setSavingDialog(false);
            toast.success("权限已更新");
            onSaved();
          }}
        />
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function BoundUsersSection({ roleId }: { roleId: number }) {
  const [users, setUsers] = useState<number[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let aborted = false;
    setUsers(null);
    setError("");
    roleApi
      .users(roleId)
      .then((u) => {
        if (!aborted) setUsers(u);
      })
      .catch((e: ApiError) => {
        if (!aborted) setError(e.message);
      });
    return () => {
      aborted = true;
    };
  }, [roleId]);

  return (
    <section className="rounded-lg border bg-background">
      <div className="border-b px-4 py-2.5 text-sm font-medium">绑定的用户</div>
      <div className="px-4 py-3">
        {error && <ErrorBanner message={error} />}
        {!error && users === null && <Skeleton className="h-8" />}
        {!error && users && users.length === 0 && (
          <p className="text-xs text-muted-foreground">暂无绑定用户</p>
        )}
        {!error && users && users.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {users.slice(0, 30).map((uid) => (
              <Badge key={uid} variant="neutral">
                #{uid}
              </Badge>
            ))}
            {users.length > 30 && (
              <Badge variant="info">+{users.length - 30} more</Badge>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function CreateRoleDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode("");
    setName("");
    setDescription("");
    setBusy(false);
  }, [open]);

  async function submit() {
    if (!code.trim() || !name.trim()) {
      toast.warn("code / name 必填");
      return;
    }
    setBusy(true);
    try {
      const id = await roleApi.create({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onCreated(id);
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
      title="新建角色"
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
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Code</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="如 CUSTOM_OPS"
          className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如 自定义运营"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">描述（可选）</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
    </Dialog>
  );
}

function SavePermissionDialog({
  open,
  onClose,
  roleId,
  codes,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  roleId: number;
  codes: string[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<"confirm" | "code">("confirm");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("confirm");
    setCode("");
    setBusy(false);
  }, [open]);

  async function requestCode() {
    setBusy(true);
    try {
      await roleApi.requestSensitiveCode(SENSITIVE_ACTION);
      toast.info("验证码已发送到钉钉");
      setStep("code");
    } catch {
      /* toast 已上报 */
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (code.trim().length !== 6) {
      toast.warn("请输入 6 位验证码");
      return;
    }
    setBusy(true);
    try {
      const { sensitiveToken } = await roleApi.verifySensitive(SENSITIVE_ACTION, code.trim());
      await roleApi.updatePermissions(roleId, codes, sensitiveToken);
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
      title="保存权限（敏感操作）"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            取消
          </button>
          {step === "confirm" ? (
            <button
              type="button"
              onClick={requestCode}
              disabled={busy}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Spinner className="mr-1" />}发送验证码
            </button>
          ) : (
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Spinner className="mr-1" />}确认保存
            </button>
          )}
        </>
      }
    >
      <p className="text-sm">
        将向当前角色保存 <span className="font-medium">{codes.length}</span> 项权限。
      </p>
      {step === "code" && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">钉钉收到的 6 位验证码</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="6 位数字"
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm tracking-widest"
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        修改将记入审计日志（ROLE_PERMISSION_CHANGE）。
      </p>
    </Dialog>
  );
}
