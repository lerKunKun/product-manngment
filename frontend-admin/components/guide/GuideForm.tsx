"use client";

import { useEffect, useState } from "react";
import { type GuideDoc, SAGA_STEPS, type SagaStep } from "@/lib/api/guide";
import { templateApi, type BaseTemplate } from "@/lib/api/template";
import { RichTextEditor } from "@/components/editor/RichTextEditor";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export type GuideFormValue = {
  code: string;
  title: string;
  category: string;
  relatedTemplateId: string; // 字符串形式便于和 select 配合
  showInSagaStep: string; // ""=未选
  bodyHtml: string;
  bodyMarkdown: string;
};

export function emptyGuideForm(): GuideFormValue {
  return {
    code: "",
    title: "",
    category: "",
    relatedTemplateId: "",
    showInSagaStep: "",
    bodyHtml: "",
    bodyMarkdown: "",
  };
}

export function fromGuideDoc(g: GuideDoc): GuideFormValue {
  return {
    code: g.code ?? "",
    title: g.title ?? "",
    category: g.category ?? "",
    relatedTemplateId: g.relatedTemplateId != null ? String(g.relatedTemplateId) : "",
    showInSagaStep: g.showInSagaStep ?? "",
    bodyHtml: g.bodyHtml ?? "",
    bodyMarkdown: g.bodyMarkdown ?? "",
  };
}

export function toGuidePayload(v: GuideFormValue): Partial<GuideDoc> {
  return {
    code: v.code.trim(),
    title: v.title.trim(),
    category: v.category.trim() || undefined,
    relatedTemplateId: v.relatedTemplateId
      ? Number(v.relatedTemplateId)
      : undefined,
    showInSagaStep: (v.showInSagaStep || undefined) as SagaStep | undefined,
    bodyHtml: v.bodyHtml || undefined,
    bodyMarkdown: v.bodyMarkdown || undefined,
  };
}

/**
 * 共享的指导文档表单（新建 / 编辑共用）。
 * - body 用 TipTap 富文本编辑器（已有的 components/editor/RichTextEditor）
 * - related template 从 templateApi 加载下拉
 * - saga step 从固定枚举加载
 *
 * 不处理提交逻辑；外层负责调用 guideApi.create/update。
 */
export function GuideForm({
  value,
  onChange,
  disableCode,
}: {
  value: GuideFormValue;
  onChange: (v: GuideFormValue) => void;
  disableCode?: boolean;
}) {
  const [templates, setTemplates] = useState<BaseTemplate[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await templateApi.list(1, 200, {});
        setTemplates(r.records ?? []);
      } catch {
        // 静默：保留空下拉
      }
    })();
  }, []);

  function patch<K extends keyof GuideFormValue>(k: K, v: GuideFormValue[K]) {
    onChange({ ...value, [k]: v });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Code（唯一标识）">
          <input
            value={value.code}
            onChange={(e) => patch("code", e.target.value)}
            disabled={disableCode}
            className={inp + (disableCode ? " bg-muted/50" : "")}
            placeholder="如 saga-media-tip"
          />
        </Field>
        <Field label="标题">
          <input
            value={value.title}
            onChange={(e) => patch("title", e.target.value)}
            className={inp}
            placeholder="如 上传媒体素材操作指南"
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="分类（选填）">
          <input
            value={value.category}
            onChange={(e) => patch("category", e.target.value)}
            className={inp}
            placeholder="如 saga / faq"
          />
        </Field>
        <Field label="关联模板（选填）">
          <select
            value={value.relatedTemplateId}
            onChange={(e) => patch("relatedTemplateId", e.target.value)}
            className={inp}
          >
            <option value="">（不关联）</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} - {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Saga 步骤（选填）">
          <select
            value={value.showInSagaStep}
            onChange={(e) => patch("showInSagaStep", e.target.value)}
            className={inp}
          >
            <option value="">（不显示在 Saga 任何步骤）</option>
            {SAGA_STEPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="正文（富文本，可切换 HTML / 预览）">
        <RichTextEditor
          value={value.bodyHtml}
          onChange={(html) => patch("bodyHtml", html)}
        />
      </Field>

      <Field label="Markdown 备份（可选；不会自动同步 HTML）">
        <textarea
          value={value.bodyMarkdown}
          onChange={(e) => patch("bodyMarkdown", e.target.value)}
          rows={4}
          className={inp + " font-mono text-xs"}
          placeholder="可选：与 HTML 同时存一份 Markdown 源码"
        />
      </Field>
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
