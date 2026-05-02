"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guideApi } from "@/lib/api/guide";
import {
  GuideForm,
  emptyGuideForm,
  toGuidePayload,
  type GuideFormValue,
} from "@/components/guide/GuideForm";
import { useToast } from "@/components/ui/Toast";

export default function NewGuidePage() {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState<GuideFormValue>(emptyGuideForm());
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.code.trim() || !value.title.trim()) {
      toast.warn("Code 和 标题 必填");
      return;
    }
    setBusy(true);
    try {
      const id = await guideApi.create(toGuidePayload(value));
      toast.success(`已创建指导 #${id}`);
      router.push(`/guides/${id}`);
    } catch {
      // toast 已上报
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/guides")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回列表
        </button>
        <h1 className="text-2xl font-semibold">新建指导文档</h1>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => router.push("/guides")}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存（DRAFT）"}
        </button>
      </div>

      <div className="rounded-lg border bg-background p-5">
        <GuideForm value={value} onChange={setValue} />
      </div>

      <p className="text-xs text-muted-foreground">
        新建后默认状态为 DRAFT，需在详情页点&quot;发布&quot;走钉钉验证码二次确认。
      </p>
    </form>
  );
}
