"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { invitationApi, type InvitationListItem } from "@/lib/api/invitation";
import type { ApiError } from "@/lib/api/client";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "待接受", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  ACCEPTED: { text: "已接受", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  LINK_EXPIRED: { text: "链接过期", cls: "bg-zinc-100 text-zinc-700 border-zinc-300" },
  REVOKED: { text: "已撤销", cls: "bg-zinc-100 text-zinc-500 border-zinc-300" },
};

export default function InvitationsPage() {
  const [list, setList] = useState<InvitationListItem[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await invitationApi.list(filter || undefined);
      setList(data);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [filter]);

  async function revokePending(id: number) {
    if (!confirm(`撤销邀请 #${id}？已发送的链接将立即失效。`)) return;
    await invitationApi.revoke(id, "manual revoke");
    load();
  }

  async function revokeUser(userId: number) {
    if (!confirm(`提前注销用户 #${userId}？账号会立即被设为 EXPIRED。`)) return;
    await invitationApi.revokeUser(userId, "manual revoke");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">临时员工邀请</h1>
        <Link
          href="/invitations/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          + 发起邀请
        </Link>
      </div>

      <div className="flex gap-2 text-sm">
        {[
          { v: "", label: "全部" },
          { v: "PENDING", label: "待接受" },
          { v: "ACCEPTED", label: "已接受" },
          { v: "LINK_EXPIRED", label: "链接过期" },
          { v: "REVOKED", label: "已撤销" },
        ].map((opt) => (
          <button
            key={opt.v}
            onClick={() => setFilter(opt.v)}
            className={
              "rounded-md border px-3 py-1.5 transition-colors " +
              (filter === opt.v ? "border-primary bg-primary text-primary-foreground" : "")
            }
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">邮箱</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">邀请时间</th>
              <th className="px-3 py-2 text-left">账号到期</th>
              <th className="px-3 py-2 text-left">链接到期</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  加载中...
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  暂无邀请记录
                </td>
              </tr>
            )}
            {list.map((it) => {
              const s = STATUS_LABEL[it.status] ?? STATUS_LABEL.REVOKED;
              return (
                <tr key={it.id} className="border-t">
                  <td className="px-3 py-2">{it.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{it.email}</td>
                  <td className="px-3 py-2">
                    <span className={"inline-block rounded border px-2 py-0.5 text-xs " + s.cls}>
                      {s.text}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(it.invitedAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(it.accountExpiresAt).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(it.linkExpiresAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {it.status === "PENDING" && (
                      <button
                        onClick={() => revokePending(it.id)}
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        撤销
                      </button>
                    )}
                    {it.status === "ACCEPTED" && it.createdUserId && (
                      <button
                        onClick={() => revokeUser(it.createdUserId!)}
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        注销账号
                      </button>
                    )}
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
