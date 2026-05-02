"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  templateApi,
  type BaseTemplateDetail,
  type BaseTemplateVersion,
  TEMPLATE_STATUS_BADGE,
} from "@/lib/api/template";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, ErrorBanner, EmptyState } from "@/components/ui/StatusBlocks";
import { Dialog } from "@/components/ui/Dialog";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type Tab = "basic" | "versions";

export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const toast = useToast();

  const [d, setD] = useState<BaseTemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("basic");
  const [savingBasic, setSavingBasic] = useState(false);

  // basic form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [coverImageR2Key, setCoverImageR2Key] = useState("");

  // upload version dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [vDraft, setVDraft] = useState<{
    version: string;
    changelog: string;
    rules: string;
    file: File | null;
  }>({ version: "", changelog: "", rules: "", file: null });
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await templateApi.detail(id);
      setD(r);
      setName(r.template.name);
      setDescription(r.template.description ?? "");
      setCategory(r.template.category ?? "");
      setCoverImageR2Key(r.template.coverImageR2Key ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveBasic() {
    setSavingBasic(true);
    try {
      await templateApi.update(id, {
        name,
        description: description || undefined,
        category: category || undefined,
        coverImageR2Key: coverImageR2Key || undefined,
      });
      toast.success("已保存");
      load();
    } catch {
      // toast 已上报
    } finally {
      setSavingBasic(false);
    }
  }

  async function doPublish() {
    if (!d) return;
    if (!d.template.defaultTemplateVersionId) {
      toast.warn("发布前必须先设置默认版本");
      return;
    }
    if (!confirm("确认发布该模板？需要钉钉验证码二次确认。")) return;
    try {
      await templateApi.requestSensitiveCode("TEMPLATE_PUBLISH");
      const code = prompt("钉钉收到的 6 位验证码：");
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

  async function doDeprecate() {
    if (!confirm("确认弃用该模板？需要钉钉验证码二次确认。")) return;
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

  async function doDelete() {
    if (!confirm("确认删除该模板？需要先弃用并钉钉验证码二次确认。")) return;
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
      router.push("/templates");
    } catch {
      // toast 已上报
    }
  }

  async function doSetDefaultVersion(v: BaseTemplateVersion) {
    if (!confirm(`将版本 ${v.version} 设为默认（同时切到 PUBLISHED）？`)) return;
    try {
      await templateApi.setDefaultVersion(id, v.id);
      toast.success(`已设默认版本：${v.version}`);
      load();
    } catch {
      // toast 已上报
    }
  }

  async function doUploadVersion() {
    if (!vDraft.version || !vDraft.file) {
      toast.warn("version 和 zip 文件必填");
      return;
    }
    if (vDraft.rules) {
      try {
        JSON.parse(vDraft.rules);
      } catch {
        toast.warn("defaultReplaceRules 不是合法 JSON");
        return;
      }
    }
    setUploading(true);
    try {
      await templateApi.requestSensitiveCode("TEMPLATE_VERSION_UPLOAD");
      const code = prompt("钉钉收到的 6 位验证码：");
      if (!code) {
        setUploading(false);
        return;
      }
      const { sensitiveToken } = await templateApi.verifySensitive(
        "TEMPLATE_VERSION_UPLOAD",
        code
      );
      const newVid = await templateApi.uploadVersion(
        id,
        vDraft.version,
        vDraft.file,
        sensitiveToken,
        {
          changelog: vDraft.changelog || undefined,
          defaultReplaceRules: vDraft.rules || undefined,
        }
      );
      toast.success(`已上传新版本 #${newVid}`);
      setUploadOpen(false);
      setVDraft({ version: "", changelog: "", rules: "", file: null });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!d) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/templates")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回列表
        </button>
        <EmptyState title="模板不存在" hint={`id=${id} 未找到`} />
      </div>
    );
  }

  const t = d.template;
  const cls =
    TEMPLATE_STATUS_BADGE[t.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";

  const tabs: { k: Tab; label: string }[] = [
    { k: "basic", label: "基础" },
    { k: "versions", label: `版本 (${d.versions.length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/templates")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回列表
        </button>
        <h1 className="text-2xl font-semibold">{t.name}</h1>
        <span className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
          {t.code}
        </span>
        <span className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}>
          {t.status}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1 border-b text-sm">
            {tabs.map((it) => (
              <button
                key={it.k}
                onClick={() => setTab(it.k)}
                className={
                  "border-b-2 px-3 py-2 transition-colors " +
                  (tab === it.k
                    ? "border-primary font-medium"
                    : "border-transparent text-muted-foreground")
                }
              >
                {it.label}
              </button>
            ))}
          </div>

          {tab === "basic" && (
            <div className="space-y-4 rounded-lg border bg-background p-5">
              <Field label="名称">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inp}
                />
              </Field>
              <Field label="描述">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={inp}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="分类">
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={inp}
                  />
                </Field>
                <Field label="封面 R2 key">
                  <input
                    value={coverImageR2Key}
                    onChange={(e) => setCoverImageR2Key(e.target.value)}
                    className={inp}
                    placeholder="templates/.../cover.png"
                  />
                </Field>
              </div>
              <button
                onClick={saveBasic}
                disabled={savingBasic}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {savingBasic ? "保存中…" : "保存基础信息"}
              </button>
            </div>
          )}

          {tab === "versions" && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={() => setUploadOpen(true)}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                >
                  + 上传新版本
                </button>
              </div>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">ID</th>
                      <th className="px-3 py-2 text-left">版本</th>
                      <th className="px-3 py-2 text-right">大小</th>
                      <th className="px-3 py-2 text-left">SHA256</th>
                      <th className="px-3 py-2 text-left">状态</th>
                      <th className="px-3 py-2 text-left">变更日志</th>
                      <th className="px-3 py-2 text-left">创建时间</th>
                      <th className="px-3 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.versions.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                          暂无版本，点&quot;+ 上传新版本&quot;
                        </td>
                      </tr>
                    )}
                    {d.versions.map((v) => {
                      const isDefault = v.id === t.defaultTemplateVersionId;
                      return (
                        <tr key={v.id} className="border-t hover:bg-muted/30">
                          <td className="px-3 py-2">{v.id}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {v.version}{" "}
                            {isDefault && (
                              <span className="ml-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-900">
                                默认
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-xs">
                            {humanBytes(v.zipBytes)}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px]">
                            {v.zipSha256
                              ? v.zipSha256.slice(0, 12) + "…"
                              : "-"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={
                                "inline-block rounded border px-2 py-0.5 text-xs " +
                                (TEMPLATE_STATUS_BADGE[v.status] ??
                                  "bg-zinc-100 text-zinc-700 border-zinc-300")
                              }
                            >
                              {v.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {v.changelog || "-"}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {v.createdAt
                              ? new Date(v.createdAt).toLocaleString("zh-CN")
                              : "-"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!isDefault && (
                              <button
                                onClick={() => doSetDefaultVersion(v)}
                                className="rounded border px-2 py-1 text-xs hover:bg-accent"
                              >
                                设为默认
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                上传走 multipart 直传 R2，sha256 由后端校验；同 templateId 下 version 唯一。
              </p>
            </div>
          )}
        </div>

        <aside className="space-y-3 rounded-lg border bg-background p-4">
          <h3 className="text-sm font-semibold">操作</h3>
          <button
            onClick={doPublish}
            disabled={t.status === "PUBLISHED"}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {t.status === "PUBLISHED" ? "已发布" : "发布"}
          </button>
          <button
            onClick={doDeprecate}
            disabled={t.status === "DEPRECATED"}
            className="w-full rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            {t.status === "DEPRECATED" ? "已弃用" : "弃用"}
          </button>
          <button
            onClick={doDelete}
            className="w-full rounded-md border border-destructive px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            删除
          </button>
          <hr />
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">默认版本</dt>
              <dd className="font-mono">{t.defaultTemplateVersionId ?? "-"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">创建时间</dt>
              <dd>
                {t.createdAt
                  ? new Date(t.createdAt).toLocaleDateString("zh-CN")
                  : "-"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">更新时间</dt>
              <dd>
                {t.updatedAt
                  ? new Date(t.updatedAt).toLocaleDateString("zh-CN")
                  : "-"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <Dialog
        open={uploadOpen}
        onClose={() => !uploading && setUploadOpen(false)}
        title="上传新版本"
        className="max-w-lg"
        footer={
          <>
            <button
              type="button"
              disabled={uploading}
              onClick={() => setUploadOpen(false)}
              className="rounded border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={doUploadVersion}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {uploading ? "上传中…" : "上传（需验证码）"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="版本号（semver, 同模板下唯一）">
            <input
              value={vDraft.version}
              onChange={(e) =>
                setVDraft({ ...vDraft, version: e.target.value })
              }
              placeholder="1.0.0"
              className={inp}
            />
          </Field>
          <Field label="主题 zip 文件（≤100MB）">
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) =>
                setVDraft({ ...vDraft, file: e.target.files?.[0] ?? null })
              }
              className="text-sm"
            />
            {vDraft.file && (
              <p className="mt-1 text-xs text-muted-foreground">
                {vDraft.file.name} · {humanBytes(vDraft.file.size)}
              </p>
            )}
          </Field>
          <Field label="变更日志（选填）">
            <textarea
              value={vDraft.changelog}
              onChange={(e) =>
                setVDraft({ ...vDraft, changelog: e.target.value })
              }
              rows={2}
              className={inp}
            />
          </Field>
          <Field label="默认替换规则 JSON（选填）">
            <textarea
              value={vDraft.rules}
              onChange={(e) => setVDraft({ ...vDraft, rules: e.target.value })}
              rows={4}
              className={inp + " font-mono text-xs"}
              placeholder='{"replace":[{"file":"layout/theme.liquid","rules":[]}]}'
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

function humanBytes(n?: number): string {
  if (n == null || isNaN(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
