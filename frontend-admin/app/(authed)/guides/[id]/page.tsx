"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { guideApi, GUIDE_STATUS_BADGE, type GuideDoc } from "@/lib/api/guide";
import {
  GuideForm,
  emptyGuideForm,
  fromGuideDoc,
  toGuidePayload,
  type GuideFormValue,
} from "@/components/guide/GuideForm";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, ErrorBanner, EmptyState } from "@/components/ui/StatusBlocks";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function GuideEditPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const toast = useToast();

  const [g, setG] = useState<GuideDoc | null>(null);
  const [value, setValue] = useState<GuideFormValue>(emptyGuideForm());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await guideApi.detail(id);
      setG(r);
      setValue(fromGuideDoc(r));
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value.title.trim()) {
      toast.warn("标题必填");
      return;
    }
    setSaving(true);
    try {
      await guideApi.update(id, toGuidePayload(value));
      toast.success("已保存");
      load();
    } catch {
      // toast 已上报
    } finally {
      setSaving(false);
    }
  }

  async function doPublish() {
    if (!confirm("确认发布该指导文档？需要钉钉验证码二次确认。")) return;
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

  async function doDelete() {
    if (!confirm("确认删除该指导文档？需要钉钉验证码二次确认。")) return;
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
      router.push("/guides");
    } catch {
      // toast 已上报
    }
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!g) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[{ href: "/guides", label: "指导文档" }, { label: `#${id}` }]} />
        <EmptyState title="文档不存在" hint={`id=${id} 未找到`} />
      </div>
    );
  }

  const cls =
    GUIDE_STATUS_BADGE[g.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300";

  return (
    <form onSubmit={save} className="space-y-4">
      <Breadcrumb items={[{ href: "/guides", label: "指导文档" }, { label: `#${id}` }]} />
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{g.title}</h1>
        <span className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
          {g.code}
        </span>
        <span className={"inline-block rounded border px-2 py-0.5 text-xs " + cls}>
          {g.status}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={doDelete}
          className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
        >
          删除
        </button>
        {g.status !== "PUBLISHED" && (
          <button
            type="button"
            onClick={doPublish}
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            发布
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      <div className="rounded-lg border bg-background p-5">
        <GuideForm value={value} onChange={setValue} disableCode />
      </div>

      <p className="text-xs text-muted-foreground">
        Code 在创建后不可修改（用作系统级唯一标识）。
      </p>
    </form>
  );
}
