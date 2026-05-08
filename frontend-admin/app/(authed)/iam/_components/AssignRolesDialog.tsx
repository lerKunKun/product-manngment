"use client";

// 用户分配角色 + 修改主部门 dialog。
// - 角色多选（除内置不让显示给 builder 选 SUPER 这种？暂未做特殊隐藏）
// - 部门单选（可清空 = null = 不挂部门）
// 提交：assignRoles(roleIds) → 若 deptId 变了 → batchUpdateDept([userId], deptId)

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { userAdminApi, type AdminUserListItem } from "@/lib/api/userAdmin";
import type { SysRole } from "@/lib/api/role";
import type { ApiError } from "@/lib/api/client";

type FlatOrgOpt = { id: number; name: string; depth: number };

export function AssignRolesDialog({
  open,
  userId,
  availableRoles,
  orgs,
  onClose,
  onSaved,
}: {
  open: boolean;
  userId: number | null;
  availableRoles: SysRole[];
  orgs: FlatOrgOpt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [user, setUser] = useState<AdminUserListItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [roleIds, setRoleIds] = useState<Set<number>>(new Set());
  const [deptId, setDeptId] = useState<number | "">("");
  const [origRoleIds, setOrigRoleIds] = useState<Set<number>>(new Set());
  const [origDeptId, setOrigDeptId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    (async () => {
      try {
        const u = await userAdminApi.get(userId);
        setUser(u);
        const rids = new Set(u.roleIds ?? []);
        setRoleIds(rids);
        setOrigRoleIds(rids);
        const did = u.deptId ?? "";
        setDeptId(did);
        setOrigDeptId(did);
      } catch (e) {
        toast.error((e as ApiError).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, userId, toast]);

  function toggleRole(id: number) {
    setRoleIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const dirty =
    roleIds.size !== origRoleIds.size ||
    [...roleIds].some((id) => !origRoleIds.has(id)) ||
    deptId !== origDeptId;

  async function save() {
    if (!user || !dirty) return;
    setBusy(true);
    try {
      // 1. 角色变更 → assignRoles
      const rolesChanged =
        roleIds.size !== origRoleIds.size ||
        [...roleIds].some((id) => !origRoleIds.has(id));
      if (rolesChanged) {
        await userAdminApi.assignRoles(user.id, Array.from(roleIds));
      }
      // 2. 部门变更 → batch-update-dept（单个用户走批量接口）
      if (deptId !== origDeptId) {
        if (deptId === "") {
          // 清空部门：当前后端 batchUpdateDept 接口要求 deptId 非空 —— 改成传 0 后端会写 0；
          // 实际后端没做"清空"语义。phase-3 加专门 endpoint，先 toast 提示。
          toast.warn("当前不支持清空部门，需要后端加专门 endpoint");
        } else {
          await userAdminApi.batchUpdateDept([user.id], Number(deptId));
        }
      }
      toast.success("已保存");
      onSaved();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? `分配角色 · ${user.username}` : "分配角色"}
      className="max-w-lg"
    >
      {!userId ? (
        <p className="py-6 text-center text-sm text-muted-foreground">未选择用户</p>
      ) : loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">加载中...</p>
      ) : !user ? (
        <p className="py-6 text-center text-sm text-muted-foreground">未找到</p>
      ) : (
        <div className="space-y-4">
          <section>
            <label className="mb-2 block text-xs font-medium">角色（多选）</label>
            <div className="flex flex-wrap gap-2">
              {availableRoles.map((r) => {
                const on = roleIds.has(r.id);
                return (
                  <label
                    key={r.id}
                    className={
                      "cursor-pointer rounded-md border px-2.5 py-1 text-xs " +
                      (on ? "border-primary bg-primary text-primary-foreground" : "")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleRole(r.id)}
                      className="mr-1 align-middle"
                    />
                    {r.name}
                    {r.builtin && (
                      <span className="ml-1 text-[10px] opacity-70">·内置</span>
                    )}
                  </label>
                );
              })}
              {availableRoles.length === 0 && (
                <span className="text-xs text-muted-foreground">无可分配角色</span>
              )}
            </div>
          </section>

          <section>
            <label className="mb-1 block text-xs font-medium">主部门（可选）</label>
            <select
              value={deptId}
              onChange={(e) =>
                setDeptId(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— 不挂部门 —</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {" ".repeat(o.depth * 2)}
                  {o.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              批量更新该用户所有角色绑定的 org_id 字段
            </p>
          </section>

          <div className="flex justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {busy ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
