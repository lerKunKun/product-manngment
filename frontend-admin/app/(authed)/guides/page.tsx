"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  guideApi,
  type GuideDoc,
  GUIDE_STATUS_BADGE,
  SAGA_STEPS,
} from "@/lib/api/guide";
import { templateApi, type BaseTemplate } from "@/lib/api/template";
import { useToast } from "@/components/ui/Toast";
import { ErrorBanner, LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";

export default function GuidesPage() {
  const [records, setRecords] = useState<GuideDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [relatedTemplateId, setRelatedTemplateId] = useState<string>("");
  const [templates, setTemplates] = useState<BaseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await guideApi.list(page, size, {
        category: category || undefined,
        status: status || undefined,
        relatedTemplateId: relatedTemplateId
          ? Number(relatedTemplateId)
          : undefined,
        keyword: keyword || undefined,
      });
      setRecords(r.records ?? []);
      setTotal(r.total ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplates() {
    try {
      const r = await templateApi.list(1, 200, {});
      setTemplates(r.records ?? []);
    } catch {
      // 失败不致命，过滤器降级为空
    }
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, relatedTemplateId]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  async function doDelete(id: number) {
    if (!confirm(`确认删除指导文档 #${id}？需要钉钉验证码二次确认。`)) return;
    try {
      await guideApi.requestSensitiveCode("GUIDE_DELETE");
      const code = prompt("钉钉收到的 6 位验证码：");
      if (!code) return;
      const { sensitiveToken } = await guideApi.verifySensitive(
        "GUIDE_DELETE",
        code
      );
      await guideApi.remove(id, sensitiveToken);
      toast.success("已删除");
      load();
    } catch {
      // toast 已上报
    }
  }

  async function doPublish(id: number) {
    if (!confirm(`确认发布指导文档 #${id}？需要钉钉验证码二次确认。`)) return;
    try {
      await guideApi.requestSensitiveCode("GUIDE_PUBLISH");
      const code = prompt("钉钉收到的 6 位验证码：");
      if (!code) return;
      const { sensitiveToken } = await guideApi.verifySensitive(
        "GUIDE_PUBLISH",
        code
      );
      await guideApi.publish(id, sensitiveToken);
      toast.success("已发布");
      load();
    } catch {
      // toast 已上报
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">指导文档</h1>
        <Link
          href="/guides/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          + 新建指导
        </Link>
      </div>

      <form onSubmit={search} className="flex flex-wrap gap-2 text-sm">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索 code / 标题..."
          className="flex-1 min-w-[200px] rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="分类"
          className="w-40 rounded-md border bg-background px-3 py-2"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2"
        >
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="PUBLISHED">已发布</option>
          <option value="ARCHIVED">已归档</option>
        </select>
        <select
          value={relatedTemplateId}
          onChange={(e) => {
            setRelatedTemplateId(e.target.value);
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2"
        >
          <option value="">不限关联模板</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} ({t.name})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          搜索
        </button>
      </form>

      <ErrorBanner message={error} onRetry={load} />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">标题</th>
              <th className="px-3 py-2 text-left">分类</th>
              <th className="px-3 py-2 text-left">Saga 步骤</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">更新时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-2">
                  <LoadingBlock />
                </td>
              </tr>
            )}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-2">
                  <EmptyState
                    title="暂无指导文档"
                    hint='点右上角"+ 新建指导"创建第一个文档'
                  />
                </td>
              </tr>
            )}
            {records.map((g) => {
              const cls =
                GUIDE_STATUS_BADGE[g.status] ??
                "bg-zinc-100 text-zinc-700 border-zinc-300";
              return (
                <tr key={g.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">{g.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/guides/${g.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {g.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{g.title}</td>
                  <td className="px-3 py-2 text-xs">{g.category || "-"}</td>
                  <td className="px-3 py-2 text-xs">
                    {g.showInSagaStep || "-"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "inline-block rounded border px-2 py-0.5 text-xs " + cls
                      }
                    >
                      {g.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {g.updatedAt
                      ? new Date(g.updatedAt).toLocaleString("zh-CN")
                      : "-"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/guides/${g.id}`}
                      className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                    >
                      编辑
                    </Link>
                    {g.status !== "PUBLISHED" && (
                      <button
                        onClick={() => doPublish(g.id)}
                        className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        发布
                      </button>
                    )}
                    <button
                      onClick={() => doDelete(g.id)}
                      className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            上一页
          </button>
          <span>
            第 {page} / {Math.max(1, Math.ceil(total / size))} 页
          </span>
          <button
            disabled={page * size >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border px-3 py-1 disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Saga 步骤可选：{SAGA_STEPS.join(" / ")}（在新建/编辑页选择）。
      </p>
    </div>
  );
}
