"use client";

// TODO i18n: 本页 UI 文案目前 hardcoded 中文；权限码描述走 lib/i18n/permissions.ts。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner, ErrorBanner, EmptyState } from "@/components/ui/StatusBlocks";
import { useToast } from "@/components/ui/Toast";
import { roleApi, type SysRole, type RoleDetail } from "@/lib/api/role";
import type { ApiError } from "@/lib/api/client";
import {
  ALL_PERMISSION_CODES,
  PERMISSION_META,
  PERMISSION_MODULES,
  moduleLabel,
  permissionLabel,
} from "@/lib/i18n/permissions";

const SENSITIVE_ACTION = "ROLE_PERMISSION_CHANGE";

/** 左栏分类节点 key（与角色 scope/builtin 相对应）。 */
type CategoryKey = "ALL" | "PLATFORM" | "TENANT" | "DEPT" | "CUSTOM";

const CATEGORIES: Array<{ key: CategoryKey; label: string; hint?: string }> = [
  { key: "ALL", label: "全部角色" },
  { key: "PLATFORM", label: "平台角色", hint: "scope=PLATFORM" },
  { key: "TENANT", label: "租户角色", hint: "scope=TENANT" },
  { key: "DEPT", label: "部门角色", hint: "scope=DEPT" },
  { key: "CUSTOM", label: "自定义角色", hint: "builtin=false" },
];

function matchCategory(role: SysRole, key: CategoryKey): boolean {
  if (key === "ALL") return true;
  if (key === "CUSTOM") return !role.builtin;
  return (role.scope ?? "").toUpperCase() === key;
}

export default function RoleAdminPage() {
  const toast = useToast();
  const [roles, setRoles] = useState<SysRole[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [category, setCategory] = useState<CategoryKey>("ALL");
  const [createOpen, setCreateOpen] = useState(false);

  const [detail, setDetail] = useState<RoleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    try {
      const list = await roleApi.list();
      setRoles(list);
      // 选中状态修复：若当前选中已不在列表则清空
      if (selectedId != null && !list.some((r) => r.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (e) {
      setListError((e as ApiError).message);
    } finally {
      setLoadingList(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选中角色后按需拉详情
  const loadDetail = useCallback(async (id: number) => {
    setLoadingDetail(true);
    setDetailError("");
    try {
      const d = await roleApi.get(id);
      setDetail(d);
    } catch (e) {
      setDetail(null);
      setDetailError((e as ApiError).message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // 切换分类后，若当前选中角色不属于新分类，则清空选中
  useEffect(() => {
    if (selectedId == null) return;
    const r = roles.find((x) => x.id === selectedId);
    if (!r || !matchCategory(r, category)) setSelectedId(null);
  }, [category, roles, selectedId]);

  // 各分类下角色数（用于左栏 badge）
  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryKey, number> = {
      ALL: roles.length,
      PLATFORM: 0,
      TENANT: 0,
      DEPT: 0,
      CUSTOM: 0,
    };
    for (const r of roles) {
      const scope = (r.scope ?? "").toUpperCase();
      if (scope === "PLATFORM") counts.PLATFORM += 1;
      else if (scope === "TENANT") counts.TENANT += 1;
      else if (scope === "DEPT") counts.DEPT += 1;
      if (!r.builtin) counts.CUSTOM += 1;
    }
    return counts;
  }, [roles]);

  const filteredRoles = useMemo(
    () => roles.filter((r) => matchCategory(r, category)),
    [roles, category]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">角色权限管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          内置角色不可改权限；自定义角色调整权限需钉钉二次确认。
        </p>
      </div>

      <ErrorBanner message={listError} onRetry={loadList} />

      {/* 三栏联动布局 */}
      <div className="flex h-[calc(100vh-220px)] min-h-[480px] gap-4">
        {/* 左栏：分类树 */}
        <RoleCategoryTree
          current={category}
          counts={categoryCounts}
          onSelect={setCategory}
        />

        {/* 中栏：角色列表 */}
        <RoleListPanel
          roles={filteredRoles}
          loading={loadingList}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onClickCreate={() => setCreateOpen(true)}
          categoryLabel={
            CATEGORIES.find((c) => c.key === category)?.label ?? "角色"
          }
        />

        {/* 右栏：权限矩阵 */}
        <section className="flex-1 min-w-0 overflow-y-auto rounded-lg border bg-background">
          {selectedId == null ? (
            <div className="grid h-full place-items-center p-8">
              <EmptyState title="请从中栏选择一个角色" />
            </div>
          ) : detailError ? (
            <div className="p-4">
              <ErrorBanner
                message={detailError}
                onRetry={() => loadDetail(selectedId)}
              />
            </div>
          ) : loadingDetail || !detail ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-20" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <RoleDetailPanel
              detail={detail}
              onSaved={() => {
                if (selectedId != null) loadDetail(selectedId);
                loadList();
              }}
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
            // 切到自定义分类，方便看到新建角色
            setCategory("CUSTOM");
            loadList();
          }}
        />
      )}
    </div>
  );
}

/* =========================================================================
 * 左栏：分类树
 * ========================================================================= */

function RoleCategoryTree({
  current,
  counts,
  onSelect,
}: {
  current: CategoryKey;
  counts: Record<CategoryKey, number>;
  onSelect: (k: CategoryKey) => void;
}) {
  return (
    <aside className="w-[200px] shrink-0 overflow-y-auto rounded-lg border bg-background">
      <div className="border-b px-3 py-2 text-sm font-medium">角色分类</div>
      <ul className="py-1">
        <li>
          {/* 一级根节点（不可点击，只是个标题） */}
          <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            按 scope 分组
          </div>
          <ul>
            {CATEGORIES.map((c) => {
              const active = c.key === current;
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.key)}
                    className={
                      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent " +
                      (active ? "bg-primary/10 font-medium" : "")
                    }
                    title={c.hint}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={
                          "inline-block h-1.5 w-1.5 rounded-full " +
                          (active ? "bg-primary" : "bg-muted-foreground/40")
                        }
                      />
                      {c.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {counts[c.key]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      </ul>
    </aside>
  );
}

/* =========================================================================
 * 中栏：角色列表
 * ========================================================================= */

function RoleListPanel({
  roles,
  loading,
  selectedId,
  onSelect,
  onClickCreate,
  categoryLabel,
}: {
  roles: SysRole[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClickCreate: () => void;
  categoryLabel: string;
}) {
  return (
    <section className="flex w-[300px] shrink-0 flex-col rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{categoryLabel}</span>
          <span className="text-xs text-muted-foreground">
            {loading ? "…" : roles.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClickCreate}
          className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
        >
          + 新建角色
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto py-1">
        {loading && (
          <li className="space-y-2 px-3 py-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </li>
        )}
        {!loading &&
          roles.map((r) => {
            const active = r.id === selectedId;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  className={
                    "block w-full px-3 py-2 text-left text-sm hover:bg-accent " +
                    (active ? "bg-primary/10" : "")
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.builtin ? (
                      <Badge variant="info">内置</Badge>
                    ) : (
                      <Badge variant="neutral">自定义</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{r.code}</span>
                    {r.scope && (
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px]">
                        {r.scope}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        {!loading && roles.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            该分类下暂无角色
          </li>
        )}
      </ul>
    </section>
  );
}

/* =========================================================================
 * 右栏：角色详情 + 权限矩阵
 * ========================================================================= */

function RoleDetailPanel({
  detail,
  onSaved,
}: {
  detail: RoleDetail;
  onSaved: () => void;
}) {
  const { role, userCount } = detail;
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <InfoCard label="名称" value={role.name} />
        <InfoCard
          label="Code"
          value={<span className="font-mono text-xs">{role.code}</span>}
        />
        <InfoCard
          label="类型"
          value={
            role.builtin ? (
              <Badge variant="info">内置</Badge>
            ) : (
              <Badge variant="neutral">自定义</Badge>
            )
          }
        />
        <InfoCard label="用户数" value={String(userCount)} />
      </div>

      {role.description && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {role.description}
        </p>
      )}

      <PermissionMatrix detail={detail} onSaved={onSaved} />
      <BoundUsersSection roleId={role.id} />
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

/* =========================================================================
 * 权限矩阵：按 module 分组，行 = code + 中英文描述 + checkbox
 * ========================================================================= */

function PermissionMatrix({
  detail,
  onSaved,
}: {
  detail: RoleDetail;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { role, permissionCodes } = detail;
  const builtin = role.builtin;

  const [selected, setSelected] = useState<Set<string>>(
    new Set(permissionCodes)
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [savingDialog, setSavingDialog] = useState(false);

  // 切换角色或父组件刷新后，重置 draft
  useEffect(() => {
    setSelected(new Set(permissionCodes));
  }, [permissionCodes, role.id]);

  // 全集 = 字典登记的所有 code ∪ 当前角色拥有的（防止后端有未登记 code 时丢失）
  const grouped = useMemo(() => {
    const set = new Set<string>(ALL_PERMISSION_CODES);
    for (const c of permissionCodes) set.add(c);
    const all = Array.from(set);
    const g: Record<string, string[]> = {};
    // 先按 PERMISSION_MODULES 顺序建桶，保证 UI 顺序稳定
    for (const m of Object.keys(PERMISSION_MODULES)) g[m] = [];
    for (const c of all) {
      const m = PERMISSION_META[c]?.module ?? "_other";
      (g[m] ??= []).push(c);
    }
    // 模块内按 code 字典序
    for (const m of Object.keys(g)) g[m].sort();
    // 移除空桶
    for (const m of Object.keys(g)) if (g[m].length === 0) delete g[m];
    return g;
  }, [permissionCodes]);

  const totalCount = useMemo(
    () => Object.values(grouped).reduce((s, a) => s + a.length, 0),
    [grouped]
  );

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

  function toggleModule(mod: string, codes: string[], checked: boolean) {
    if (builtin) return;
    setSelected((s) => {
      const next = new Set(s);
      for (const c of codes) {
        if (checked) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  }

  function setModuleCollapsed(mod: string) {
    setCollapsed((m) => ({ ...m, [mod]: !m[mod] }));
  }

  return (
    <section className="rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">权限矩阵</h2>
          <span className="text-xs text-muted-foreground">
            共 {selected.size} / {totalCount} 项
          </span>
        </div>
        {!builtin && dirty && <Badge variant="warning">未保存的修改</Badge>}
      </div>

      {builtin && (
        <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">
          内置角色不可修改权限
        </div>
      )}

      <div className="space-y-3 px-4 py-3">
        {Object.keys(grouped).length === 0 && (
          <p className="text-xs text-muted-foreground">
            暂未发现已配置的权限点
          </p>
        )}
        {Object.entries(grouped).map(([mod, codes]) => {
          const ownedInMod = codes.filter((c) => selected.has(c)).length;
          const allOwned = ownedInMod === codes.length;
          const someOwned = ownedInMod > 0 && !allOwned;
          const isCollapsed = !!collapsed[mod];
          return (
            <div key={mod} className="rounded-md border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setModuleCollapsed(mod)}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <span
                    className={
                      "inline-block transition-transform " +
                      (isCollapsed ? "" : "rotate-90")
                    }
                  >
                    {/* 简易箭头：避免引入 icon 依赖 */}
                    {/* TODO i18n: 折叠图标无文字 */}
                    {"▶"}
                  </span>
                  <span>{moduleLabel(mod, "zh")}</span>
                  <span className="text-xs text-muted-foreground">
                    {moduleLabel(mod, "en")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ownedInMod}/{codes.length}
                  </span>
                </button>
                {!builtin && (
                  <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allOwned}
                      ref={(el) => {
                        if (el) el.indeterminate = someOwned;
                      }}
                      onChange={(e) =>
                        toggleModule(mod, codes, e.target.checked)
                      }
                    />
                    全选
                  </label>
                )}
              </div>
              {!isCollapsed && (
                <table className="w-full table-fixed text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="w-10 px-3 py-1.5 text-left"></th>
                      <th className="w-[28%] px-3 py-1.5 text-left font-normal">
                        Code
                      </th>
                      <th className="w-[34%] px-3 py-1.5 text-left font-normal">
                        中文描述
                      </th>
                      <th className="px-3 py-1.5 text-left font-normal">
                        English
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => {
                      const checked = selected.has(c);
                      const meta = PERMISSION_META[c];
                      return (
                        <tr
                          key={c}
                          className={
                            "border-b last:border-b-0 hover:bg-muted/20 " +
                            (checked ? "bg-primary/[0.03]" : "")
                          }
                        >
                          <td className="px-3 py-1.5">
                            <input
                              type="checkbox"
                              disabled={builtin}
                              checked={checked}
                              onChange={() => toggle(c)}
                              className={
                                builtin ? "cursor-not-allowed opacity-60" : ""
                              }
                            />
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs">
                            {c}
                            {!meta && (
                              <span className="ml-1 text-[10px] text-amber-600">
                                未登记
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {permissionLabel(c, "zh")}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">
                            {permissionLabel(c, "en")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
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
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            保存修改
          </button>
        </div>
      )}

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
    </section>
  );
}

/* =========================================================================
 * 绑定用户
 * ========================================================================= */

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
      <div className="border-b px-4 py-2.5 text-sm font-medium">
        绑定的用户
      </div>
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

/* =========================================================================
 * 新建角色对话框
 * ========================================================================= */

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
        <label className="mb-1 block text-xs text-muted-foreground">
          Code
        </label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="如 CUSTOM_OPS"
          className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          名称
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如 自定义运营"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          描述（可选）
        </label>
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

/* =========================================================================
 * 保存权限：钉钉 6 位码二次确认
 * ========================================================================= */

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
      const { sensitiveToken } = await roleApi.verifySensitive(
        SENSITIVE_ACTION,
        code.trim()
      );
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
        将向当前角色保存 <span className="font-medium">{codes.length}</span>{" "}
        项权限。
      </p>
      {step === "code" && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            钉钉收到的 6 位验证码
          </label>
          <input
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
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
