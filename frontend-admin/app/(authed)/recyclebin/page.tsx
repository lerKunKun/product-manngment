"use client";

import { useEffect, useState } from "react";
import { recycleApi, type RecycleItem } from "@/lib/api/recyclebin";
import type { ApiError } from "@/lib/api/client";

const TABS: { key: "sys_user" | "user_invitation" | "sys_org"; label: string }[] = [
  { key: "sys_user", label: "用户" },
  { key: "user_invitation", label: "邀请记录" },
  { key: "sys_org", label: "组织" },
];

export default function RecycleBinPage() {
  const [tab, setTab] = useState<typeof TABS[number]["key"]>("sys_user");
  const [items, setItems] = useState<RecycleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setItems(await recycleApi.list(tab));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [tab]);

  async function restore(id: number) {
    if (!confirm(`恢复 ${tab}#${id}？需要钉钉验证码二次确认。`)) return;
    try {
      await recycleApi.requestSensitiveCode("RECYCLE_RESTORE");
      const code = prompt("钉钉收到的 6 位验证码（钉钉未配 dingtalk_userid 时看 backend 日志）：");
      if (!code) return;
      const { sensitiveToken } = await recycleApi.verifySensitive("RECYCLE_RESTORE", code);
      await recycleApi.restore(tab, id, sensitiveToken);
      load();
    } catch (e) {
      alert("恢复失败：" + (e as ApiError).message);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">回收站</h1>
      <p className="text-sm text-muted-foreground">软删除的数据保留 90 天后自动物理删。恢复需钉钉二次确认。</p>

      <div className="flex gap-2 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-md border px-3 py-1.5 transition-colors " +
              (tab === t.key ? "border-primary bg-primary text-primary-foreground" : "")
            }
          >
            {t.label}
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
              <th className="px-3 py-2 text-left">摘要</th>
              <th className="px-3 py-2 text-left">删除时间</th>
              <th className="px-3 py-2 text-left">剩余天数</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  加载中...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  回收站为空
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-3 py-2">{it.id}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {String(it.username ?? it.email ?? it.name ?? "-")}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {it.deleted_at ? new Date(String(it.deleted_at)).toLocaleString("zh-CN") : "-"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {typeof it.days_left === "number" ? `${it.days_left} 天` : "-"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => restore(Number(it.id))}
                    className="rounded border px-2 py-1 text-xs hover:bg-accent"
                  >
                    恢复
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
