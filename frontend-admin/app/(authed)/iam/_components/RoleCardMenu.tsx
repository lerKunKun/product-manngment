"use client";

// 角色卡片右上 ⋯ 菜单：编辑权限 / 编辑信息 / 删除。
// 删除走 SensitiveActionDialog（action=ROLE_DELETE）；后端会再校验内置角色 + 用户引用。

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { SensitiveActionDialog } from "@/components/SensitiveActionDialog";
import { roleApi, type SysRole } from "@/lib/api/role";
import type { ApiError } from "@/lib/api/client";

export function RoleCardMenu({
  role,
  onEditPermissions,
  onEditInfo,
  onChanged,
}: {
  role: SysRole;
  onEditPermissions: () => void;
  onEditInfo: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const builtin = role.builtin;
  const [stepUpOpen, setStepUpOpen] = useState(false);

  function startDelete() {
    if (builtin) {
      toast.info("内置角色禁删");
      return;
    }
    if (!confirm(`确认删除角色「${role.name}」？仍在使用该角色的用户会被拦下，需要先解除绑定。`)) return;
    setStepUpOpen(true);
  }

  async function onConfirmed(token: string) {
    try {
      await roleApi.remove(role.id, token);
      toast.success("角色已删除");
      onChanged();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setStepUpOpen(false);
    }
  }

  return (
    <>
      <DropdownMenu
        trigger={
          <button
            type="button"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <MoreHorizontal className="size-4" />
          </button>
        }
      >
        <DropdownItem onClick={onEditPermissions}>编辑权限</DropdownItem>
        <DropdownItem disabled={builtin} onClick={onEditInfo}>
          编辑信息
        </DropdownItem>
        <DropdownItem disabled={builtin} variant="destructive" onClick={startDelete}>
          删除角色
        </DropdownItem>
      </DropdownMenu>

      <SensitiveActionDialog
        open={stepUpOpen}
        action="ROLE_DELETE"
        description={`删除角色「${role.name}」（${role.code}）`}
        onClose={() => setStepUpOpen(false)}
        onConfirmed={onConfirmed}
      />
    </>
  );
}
