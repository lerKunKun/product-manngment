"use client";

// 角色 创建 / 编辑信息 dialog。
// - mode="create"：编辑 code/name/scope/description（POST /admin/role）
// - mode="edit" + role：仅编辑 name/description（PUT /admin/role/{id}），code/scope 锁定
// 内置角色禁改（前端 UI 也禁用）。

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { roleApi, type SysRole } from "@/lib/api/role";
import type { ApiError } from "@/lib/api/client";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted/50 disabled:text-muted-foreground";

type Mode = "create" | "edit";

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: "PLATFORM", label: "全局（PLATFORM）" },
  { value: "TENANT", label: "租户（TENANT）" },
  { value: "DEPT", label: "组织（DEPT）" },
];

export function RoleEditDialog({
  open,
  mode,
  role,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: Mode;
  /** edit 模式必填 */
  role?: SysRole | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<string>("TENANT");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    if (mode === "edit" && role) {
      setCode(role.code);
      setName(role.name);
      setScope(role.scope ?? "TENANT");
      setDescription(role.description ?? "");
    } else {
      setCode("");
      setName("");
      setScope("TENANT");
      setDescription("");
    }
  }, [open, mode, role]);

  const builtin = mode === "edit" && (role?.builtin ?? false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("名称必填");
      return;
    }
    if (mode === "create") {
      if (!code.trim()) {
        setError("编码必填");
        return;
      }
      if (!/^[A-Z][A-Z0-9_]+$/.test(code.trim())) {
        setError("编码只能用大写字母 + 数字 + 下划线，需以字母开头");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "create") {
        await roleApi.create({
          code: code.trim(),
          name: name.trim(),
          scope,
          description: description.trim() || undefined,
        });
        toast.success("角色已创建");
      } else if (role) {
        await roleApi.update(role.id, {
          name: name.trim(),
          description: description.trim() ?? undefined,
        });
        toast.success("已保存");
      }
      onSaved();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "新建角色" : "编辑角色信息"}
      className="max-w-md"
    >
      {builtin && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          内置角色不可改
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <Field label="编码（code）" required={mode === "create"}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={mode === "edit"}
            className={inp}
            placeholder="例：FINANCE_MANAGER"
          />
          {mode === "edit" && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              code 创建后不可改（影响 sys_role_permission 关联）
            </p>
          )}
        </Field>

        <Field label="名称" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={builtin}
            className={inp}
            placeholder="例：财务经理"
          />
        </Field>

        <Field label="数据范围（scope）">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={mode === "edit"}
            className={inp}
          >
            {SCOPE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {mode === "edit" && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              scope 创建后不可改（影响数据范围语义）
            </p>
          )}
        </Field>

        <Field label="描述">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={builtin}
            rows={2}
            className={inp}
            placeholder="一句话描述该角色的职责"
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || builtin}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "保存中..." : mode === "create" ? "创建" : "保存"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}
