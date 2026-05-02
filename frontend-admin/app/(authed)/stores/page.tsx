"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { storeApi, type StoreItem } from "@/lib/api/store";
import type { ApiError } from "@/lib/api/client";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "正常", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  DISABLED: { text: "已停用", cls: "bg-zinc-100 text-zinc-500 border-zinc-300" },
  TOKEN_EXPIRED: { text: "Token 已过期", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  UNINSTALLED: { text: "已卸载", cls: "bg-rose-100 text-rose-900 border-rose-300" },
};

export default function StoresPage() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      setStores(await storeApi.list());
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">店铺管理</h1>
        <Link
          href="/stores/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          + 接入店铺
        </Link>
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
              <th className="px-3 py-2 text-left">店铺域名</th>
              <th className="px-3 py-2 text-left">品牌名</th>
              <th className="px-3 py-2 text-left">Token 类型</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">接入时间</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">加载中...</td></tr>
            )}
            {!loading && stores.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">暂无店铺，点右上角接入</td></tr>
            )}
            {stores.map((s) => {
              const sl = STATUS_LABEL[s.status] ?? STATUS_LABEL.DISABLED;
              return (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-2">{s.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.myshopifyDomain}</td>
                  <td className="px-3 py-2">{s.brandName || "-"}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="rounded border px-1.5 py-0.5 font-mono">{s.tokenType}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={"inline-block rounded border px-2 py-0.5 text-xs " + sl.cls}>
                      {sl.text}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString("zh-CN")}
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
