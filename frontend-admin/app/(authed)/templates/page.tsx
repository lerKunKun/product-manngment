"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  templateApi,
  type BaseTemplate,
  TEMPLATE_STATUS_BADGE,
} from "@/lib/api/template";
import { useToast } from "@/components/ui/Toast";
import { ErrorBanner, LoadingBlock, EmptyState } from "@/components/ui/StatusBlocks";
import { Dialog } from "@/components/ui/Dialog";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export default function TemplatesPage() {
  const [records, setRecords] = useState<BaseTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const toast = useToast();

  // create form state
  const [draft, setDraft] = useState<{
    code: string;
    name: string;
    description: string;
    category: string;
  }>({ code: "", name: "", description: "", category: "" });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await templateApi.list(page, size, {
        category: category || undefined,
        status: status || undefined,
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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, category]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load();
  }

  async function doCreate() {
    if (!draft.code || !draft.name) {
      toast.warn("code 和 name 必填");
      return;
    }
    setCreating(true);
    try {
      const id = await templateApi.create({
        code: draft.code,
        name: draft.name,
        description: draft.description || undefined,
        category: draft.category || undefined,
      });
      toast.success(`已创建模板 #${id}`);
      setCreateOpen(false);
      setDraft({ code: "", name: "", description: "", category: "" });
      load();
    } catch {
      // 全局 toast 已上报
    } finally {
      setCreating(false);
    }
  }

  async function doPublish(id: number) {
    if (!confirm(`确认发布模板 #${id}？需要钉钉验证码二次确认。`)) return;
    try {
      await templateApi.requestSensitiveCode("TEMPLATE_PUBLISH");
      const code = prompt("钉钉收到的 6 位验证码（或看 backend 日志）：");
      if (!code) return;
      const { sensitiveToken } = await templateApi.verifySensitive(
        "TEMPLATE_PUBLISH",
        code
      );
      await templateApi.publish(id, sensitiveToken);
      toast.success("已发布");
      load();
    } catch {
      // toast 已上报
    }
  }

  async function doDeprecate(id: number) {
    if (!confirm(`确认弃用模板 #${id}？需要钉钉验证码二次确认。`)) return;
    try {
      await templateApi.requestSensitiveCode("TEMPLATE_DEPRECATE");
      const code = prompt("钉钉收到的 6 位验证码：");
      if (!code) return;
      const { sensitiveToken } = await templateApi.verifySensitive(
        "TEMPLATE_DEPRECATE",
        code
      );
      await templateApi.deprecate(id, sensitiveToken);
      toast.success("已弃用");
      load();
    } catch {
      // toast 已上报
    }
  }

  async function doDelete(id: number) {
    if (!confirm(`确认删除模板 #${id}？需要先弃用且需要钉钉验证码二次确认。`)) return;
    try {
      await templateApi.requestSensitiveCode("TEMPLATE_DELETE");
      const code = prompt("钉钉收到的 6 位验证码：");
      if (!code) return;
      const { sensitiveToken } = await templateApi.verifySensitive(
        "TEMPLATE_DELETE",
        code
      );
      await templateApi.remove(id, sensitiveToken);
      toast.success("已删除");
      load();
    } catch {
      // toast 已上报
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">模板库</h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          + 新建模板
        </button>
      </div>

      <form onSubmit={search} className="flex flex-wrap gap-2 text-sm">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索 code / name / description..."
          className="flex-1 min-w-[200px] rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="分类（如 fashion）"
          className="w-44 rounded-md border bg-background px-3 py-2"
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
          <option value="DEPRECATED">已弃用</option>
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
              <th className="px-3 py-2 text-left">名称</th>
              <th className="px-3 py-2 text-left">分类</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-right">默认版本</th>
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
                    title="暂无模板"
                    hint='点右上角"+ 新建模板"创建第一个基础模板'
                  />
                </td>
              </tr>
            )}
            {records.map((t) => {
              const cls =
                TEMPLATE_STATUS_BADGE[t.status] ??
                "bg-zinc-100 text-zinc-700 border-zinc-300";
              return (
                <tr key={t.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">{t.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/templates/${t.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {t.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{t.name}</td>
                  <td className="px-3 py-2 text-xs">{t.category || "-"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "inline-block rounded border px-2 py-0.5 text-xs " + cls
                      }
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {t.defaultTemplateVersionId ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {t.updatedAt
                      ? new Date(t.updatedAt).toLocaleString("zh-CN")
                      : "-"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/templates/${t.id}`}
                      className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                    >
                      查看
                    </Link>
                    {t.status === "DRAFT" && (
                      <button
                        onClick={() => doPublish(t.id)}
                        className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        发布
                      </button>
                    )}
                    {t.status === "PUBLISHED" && (
                      <button
                        onClick={() => doDeprecate(t.id)}
                        className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        弃用
                      </button>
                    )}
                    <button
                      onClick={() => doDelete(t.id)}
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建模板"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded border px-3 py-1.5 text-sm hover:bg-accent"
            >
              取消
            </button>
            <button
              type="button"
              onClick={doCreate}
              disabled={creating}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {creating ? "创建中…" : "创建"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Code（唯一标识）">
            <input
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              className={inp}
              placeholder="如 dawn-fashion"
            />
          </Field>
          <Field label="名称">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={inp}
              placeholder="如 时尚女装基础模板"
            />
          </Field>
          <Field label="分类（选填）">
            <input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              className={inp}
              placeholder="如 fashion"
            />
          </Field>
          <Field label="描述（选填）">
            <textarea
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              rows={3}
              className={inp}
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
