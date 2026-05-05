"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  templateVersionApi,
  TEMPLATE_VERSION_STATUS_BADGE,
  type TemplateVersion,
} from "@/lib/api/templateVersion";
import { useToast } from "@/components/ui/Toast";
import { ErrorBanner, LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";
import { useI18n } from "@/lib/i18n/context";

/**
 * AS6 · 模板版本管理列表页（独立路由 /template-versions）。
 *
 * <p>列：模板名（join）/ 版本号 / 默认规则数 / 创建人 / 创建时间 / 操作。
 * 顶部：搜索框 + 新建按钮。删除走 confirm 二次确认（不需要钉钉敏感码）。
 *
 * <p>父模板 CRUD（base_template）仍在 /templates 下；本页只负责版本行的 metadata。
 */
export default function TemplateVersionsPage() {
  const { t } = useI18n();
  const toast = useToast();

  const [records, setRecords] = useState<TemplateVersion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await templateVersionApi.list(page, size, appliedKeyword || undefined);
      setRecords(r.records ?? []);
      setTotal(r.total ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, appliedKeyword]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedKeyword(keyword);
  }

  async function doDelete(id: number) {
    if (!confirm(t("templateVersion.confirmDelete").replace("{id}", String(id)))) return;
    try {
      await templateVersionApi.remove(id);
      toast.success(t("templateVersion.deleteSuccess"));
      load();
    } catch {
      // 错误已由全局 toast 上报
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("templateVersion.title")}</h1>
        <Link
          href="/template-versions/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          + {t("templateVersion.create")}
        </Link>
      </div>

      <form onSubmit={search} className="flex flex-wrap gap-2 text-sm">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t("templateVersion.search")}
          className="flex-1 min-w-[240px] rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          {t("common.search")}
        </button>
      </form>

      <ErrorBanner message={error} onRetry={load} />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">{t("templateVersion.column.name")}</th>
              <th className="px-3 py-2 text-left">{t("templateVersion.column.version")}</th>
              <th className="px-3 py-2 text-right">{t("templateVersion.column.rulesCount")}</th>
              <th className="px-3 py-2 text-left">{t("templateVersion.column.creator")}</th>
              <th className="px-3 py-2 text-left">{t("templateVersion.column.createdAt")}</th>
              <th className="px-3 py-2 text-right">{t("templateVersion.column.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-2">
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-2">
                  <EmptyState title={t("common.empty")} />
                </td>
              </tr>
            )}
            {records.map((v) => {
              const cls =
                TEMPLATE_VERSION_STATUS_BADGE[v.status] ??
                "bg-zinc-100 text-zinc-700 border-zinc-300";
              return (
                <tr key={v.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">{v.id}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/template-versions/${v.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {v.templateName ?? `#${v.templateId ?? "-"}`}
                    </Link>
                    <span className="ml-2">
                      <span
                        className={
                          "inline-block rounded border px-1.5 py-0.5 text-[10px] " + cls
                        }
                      >
                        {v.status}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{v.version}</td>
                  <td className="px-3 py-2 text-right">{v.rulesCount ?? 0}</td>
                  <td className="px-3 py-2 text-xs">{v.createdBy ?? "-"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {v.createdAt ? new Date(v.createdAt).toLocaleString("zh-CN") : "-"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/template-versions/${v.id}`}
                      className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                    >
                      {t("templateVersion.edit")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => doDelete(v.id)}
                      className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      {t("templateVersion.delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("common.total").replace("{count}", String(total))}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            {t("common.prev")}
          </button>
          <span>
            {page} / {Math.max(1, Math.ceil(total / size))}
          </span>
          <button
            type="button"
            disabled={page * size >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            {t("common.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
