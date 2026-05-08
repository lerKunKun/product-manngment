"use client";

// 用户行末菜单：冻结/解冻/重置密码/分配角色/Impersonate/删除。
// 重置密码 + Impersonate 走 SensitiveActionDialog（钉钉验证码 step-up）。
// 重置完成后单独 dialog 把临时明文一次性给操作员看（关掉就拿不回）。

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { SensitiveActionDialog } from "@/components/SensitiveActionDialog";
import { userAdminApi, type AdminUserListItem } from "@/lib/api/userAdmin";
import { useAuthStore } from "@/lib/auth/store";
import type { ApiError } from "@/lib/api/client";

type Pending = null | "RESET_PWD" | "IMPERSONATE";

export function UserRowMenu({
  user,
  onChanged,
  onAssignRoles,
}: {
  user: AdminUserListItem;
  onChanged: () => void;
  onAssignRoles: () => void;
}) {
  const toast = useToast();
  const isFrozen = user.status === "FROZEN";
  const [pending, setPending] = useState<Pending>(null);
  // 重置密码后给操作员一次性看明文
  const [tempPwd, setTempPwd] = useState<string | null>(null);

  async function freeze() {
    try {
      await userAdminApi.freeze(user.id);
      toast.success("已冻结");
      onChanged();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }
  async function unfreeze() {
    try {
      await userAdminApi.unfreeze(user.id);
      toast.success("已解冻");
      onChanged();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }
  async function remove() {
    if (!confirm(`确认删除用户「${user.username}」？该操作不可逆。`)) return;
    try {
      await userAdminApi.remove(user.id);
      toast.success("已删除");
      onChanged();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  async function onConfirmed(token: string) {
    if (pending === "RESET_PWD") {
      try {
        const r = await userAdminApi.resetPassword(user.id, token);
        setTempPwd(r.temporaryPassword);
        toast.success("密码已重置");
        onChanged();
      } catch (e) {
        toast.error((e as ApiError).message);
      }
    } else if (pending === "IMPERSONATE") {
      try {
        const r = await userAdminApi.impersonate(user.id, token);
        // 切换到目标身份：把当前 access token 换成新的。原 refresh cookie 保持，token 到期回身份。
        useAuthStore.getState().setSession(
          {
            userId: r.targetUserId,
            username: r.targetUsername,
            employeeNo: r.targetEmployeeNo,
            userType: "STAFF",
            passwordMustChange: false,
          },
          r.accessToken
        );
        toast.success(`已切换到 ${r.targetUsername}（${r.expiresInSeconds}s 后到期）`);
        // 刷新页面让新身份生效
        setTimeout(() => window.location.reload(), 500);
      } catch (e) {
        toast.error((e as ApiError).message);
      }
    }
    setPending(null);
  }

  return (
    <>
      <DropdownMenu
        trigger={
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent"
          >
            <MoreHorizontal className="size-4" />
          </button>
        }
      >
        {isFrozen ? (
          <DropdownItem onClick={unfreeze}>解冻账号</DropdownItem>
        ) : (
          <DropdownItem onClick={freeze}>冻结账号</DropdownItem>
        )}
        <DropdownItem onClick={() => setPending("RESET_PWD")}>
          重置密码
        </DropdownItem>
        <DropdownItem onClick={onAssignRoles}>分配角色</DropdownItem>
        <DropdownItem onClick={() => setPending("IMPERSONATE")}>
          Impersonate
        </DropdownItem>
        <DropdownItem variant="destructive" onClick={remove}>
          删除用户
        </DropdownItem>
      </DropdownMenu>

      <SensitiveActionDialog
        open={pending !== null}
        action={pending === "RESET_PWD" ? "USER_RESET_PASSWORD" : "IMPERSONATE_USER"}
        description={
          pending === "RESET_PWD"
            ? `重置「${user.username}」的密码（生成 12 位随机临时密码，下次登录强制改）`
            : `以「${user.username}」身份登录（10 分钟到期回原身份，全程审计）`
        }
        onClose={() => setPending(null)}
        onConfirmed={onConfirmed}
      />

      {/* 临时密码一次性查看 */}
      <Dialog
        open={tempPwd !== null}
        onClose={() => setTempPwd(null)}
        title="临时密码（一次性查看）"
      >
        <p className="text-sm text-muted-foreground">
          请把以下临时密码当面 / 私聊安全告知用户，关闭后无法再查看。
          首次登录会强制改密。
        </p>
        <div className="my-3 rounded-md border bg-muted/30 px-3 py-2 font-mono text-base tracking-wider">
          {tempPwd}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(tempPwd ?? "").then(
                () => toast.success("已复制"),
                () => toast.warn("复制失败")
              );
            }}
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          >
            复制
          </button>
          <button
            type="button"
            onClick={() => setTempPwd(null)}
            className="ml-2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          >
            我已记下
          </button>
        </div>
      </Dialog>
    </>
  );
}
