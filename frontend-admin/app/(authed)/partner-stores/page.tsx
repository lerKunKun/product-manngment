"use client";

/**
 * W3-PV-02: 合作者店铺池前端落地页。
 *
 * 业务定位：dev-store 池供产品详情页 → 预览功能（W3-PV-05）选用；这里是池
 * 的可视化 + 标记入口。
 *
 * 功能：
 * - 列表：ID / 店铺品牌 / domain / isDevStore / isPartnerCollab / 状态 /
 *   当前活跃预览数（Day 4 客户端聚合，跨产品全局视角，不分 tenant 因当前
 *   /preview list 不支持按 tenantId 过滤；用 PENDING/BUILDING/READY 计数）
 * - 过滤：全部 | 仅合作者池 | 仅 dev store
 * - 行内动作：标记 / 取消合作者池（敏感操作 → 钉钉 6 位验证码二次确认）
 *
 * 添加店铺：跳转 /stores/new（复用现有接入页面，进去时勾选「合作者池」）。
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { storeApi, type StoreItem } from "@/lib/api/store";
import { previewApi, type PreviewTheme } from "@/lib/api/preview";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";
import type { ApiError } from "@/lib/api/client";

type Filter = "all" | "partnerCollab" | "devStore";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ACTIVE: { text: "正常", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  DISABLED: { text: "已停用", cls: "bg-zinc-100 text-zinc-500 border-zinc-300" },
  TOKEN_EXPIRED: { text: "Token 已过期", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  UNINSTALLED: { text: "已卸载", cls: "bg-rose-100 text-rose-900 border-rose-300" },
};

const ACTIVE_PREVIEW_STATUSES = new Set(["PENDING", "BUILDING", "READY"]);

export default function PartnerStoresPage() {
  const toast = useToast();
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [previews, setPreviews] = useState<PreviewTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("partnerCollab");

  async function load() {
    setLoading(true);
    setError("");
    try {
      // 1) 拉店铺。filter=partnerCollab → 只拿池里的；其它从全量再前端过滤。
      const params =
        filter === "partnerCollab"
          ? { partnerCollab: true }
          : filter === "devStore"
          ? { devStore: true }
          : undefined;
      const list = await storeApi.list(params);
      setStores(list);

      // 2) 聚合预览数：/preview 不带过滤 → 拉全部活跃行，按 devStoreId 分桶。
      // 当前没有 tenant 维度过滤接口，先用全局视角；当池规模大时再优化为
      // 后端聚合 endpoint（TODO Day 5+）。
      try {
        const all = await previewApi.list();
        setPreviews(all);
      } catch {
        // 列预览失败不影响店铺渲染，把计数列留空就行
        setPreviews([]);
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // devStoreId → 当前活跃预览数
  const activeCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of previews) {
      if (!ACTIVE_PREVIEW_STATUSES.has(p.status)) continue;
      m.set(p.devStoreId, (m.get(p.devStoreId) ?? 0) + 1);
    }
    return m;
  }, [previews]);

  async function withSensitiveToken(
    action: string
  ): Promise<string | null> {
    try {
      await storeApi.requestSensitiveCode(action);
    } catch (e) {
      toast.error("发送验证码失败：" + (e as ApiError).message);
      return null;
    }
    const code = window.prompt("请输入钉钉收到的 6 位验证码：");
    if (!code) return null;
    try {
      const r = await storeApi.verifySensitive(action, code.trim());
      return r.sensitiveToken;
    } catch (e) {
      toast.error("验证码校验失败：" + (e as ApiError).message);
      return null;
    }
  }

  async function togglePartnerCollab(s: StoreItem) {
    const currently = s.isPartnerCollab === true;
    const verb = currently ? "移出" : "加入";
    if (!window.confirm(`${verb}合作者店铺池：${s.myshopifyDomain}？`)) return;
    const token = await withSensitiveToken("STORE_MARK_PARTNER_COLLAB");
    if (!token) return;
    try {
      if (currently) await storeApi.unmarkPartnerCollab(s.id, token);
      else await storeApi.markPartnerCollab(s.id, token);
      toast.success(`已${verb}合作者池：${s.myshopifyDomain}`);
      load();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">合作者店铺池</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            partner-collab + ACTIVE 的 dev store 用于产品「预览」按钮；同一店铺最多 3 个并发预览。
          </p>
        </div>
        <Link
          href="/stores/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          + 添加合作者店铺
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 text-sm">
        <span className="text-muted-foreground">视图：</span>
        {(
          [
            { k: "partnerCollab" as const, label: "仅合作者池" },
            { k: "devStore" as const, label: "仅 dev store" },
            { k: "all" as const, label: "全部店铺" },
          ]
        ).map((opt) => (
          <button
            key={opt.k}
            onClick={() => setFilter(opt.k)}
            className={
              "rounded border px-3 py-1 text-xs transition-colors " +
              (filter === opt.k
                ? "border-primary bg-primary/10 text-primary"
                : "hover:bg-accent")
            }
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          共 {stores.length} 家
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingBlock />
      ) : stores.length === 0 ? (
        <EmptyState
          title="暂无店铺"
          hint={
            filter === "partnerCollab"
              ? "尚未把任何店铺标记为合作者池。可在「店铺管理」选择 dev store 后加入。"
              : "尚未接入任何符合条件的店铺。"
          }
          action={
            <Link
              href="/stores/new"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              去添加
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">店铺品牌</th>
                <th className="px-3 py-2 text-left">myshopify 域名</th>
                <th className="px-3 py-2 text-center">isDevStore</th>
                <th className="px-3 py-2 text-center">isPartnerCollab</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-right">当前预览数</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => {
                const sl = STATUS_LABEL[s.status] ?? STATUS_LABEL.DISABLED;
                const cnt = activeCount.get(s.id) ?? 0;
                const isPc = s.isPartnerCollab === true;
                return (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2 text-xs">{s.id}</td>
                    <td className="px-3 py-2">{s.brandName || "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.myshopifyDomain}</td>
                    <td className="px-3 py-2 text-center">
                      {s.isDevStore ? (
                        <span className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-900">
                          dev
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isPc ? (
                        <span className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-900">
                          ✓ 池内
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={"inline-block rounded border px-2 py-0.5 text-xs " + sl.cls}>
                        {sl.text}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={
                          "rounded px-2 py-0.5 text-xs font-mono " +
                          (cnt >= 3
                            ? "bg-amber-100 text-amber-900"
                            : cnt > 0
                            ? "bg-zinc-100 text-zinc-900"
                            : "text-muted-foreground")
                        }
                        title={cnt >= 3 ? "已达单店上限 3" : "活跃预览（PENDING/BUILDING/READY）"}
                      >
                        {cnt} / 3
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => togglePartnerCollab(s)}
                        className={
                          "rounded border px-2 py-1 text-xs " +
                          (isPc
                            ? "border-amber-300 text-amber-900 hover:bg-amber-50"
                            : "hover:bg-accent")
                        }
                      >
                        {isPc ? "移出池" : "加入池"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        合作者池配额：单店最多 3 个并发预览主题，24h 自动过期（preview_theme.expires_at）。
        过期清理由后端 PreviewThemeCleanupScheduler 兜底（每 30 分钟一次）。
      </p>
    </div>
  );
}
