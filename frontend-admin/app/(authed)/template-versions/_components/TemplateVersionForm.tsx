"use client";

import { useEffect, useState } from "react";
import {
  EXAMPLE_REPLACE_RULES_JSON,
  type TemplateVersion,
} from "@/lib/api/templateVersion";
import { templateApi, type BaseTemplate } from "@/lib/api/template";
import { useI18n } from "@/lib/i18n/context";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** semver-ish: 1.0.0 / 1.1.0-beta / 2.0.0-rc.1 —— 与后端 BaseTemplateVersionService.VERSION_PATTERN 对齐 */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export type TemplateVersionFormValue = {
  version: string;
  description: string;
  defaultReplaceRulesJson: string;
};

/**
 * AS6 · 模板版本编辑表单（仅 edit）。
 *
 * <p>新建走 /template-versions/new 的 multipart 上传流程（不复用此组件），
 * 因为 V15 zip_r2_key NOT NULL，模板版本本质必带 zip 文件。
 *
 * <p>提交前在客户端做：
 *   1. version 走 semver-ish 校验
 *   2. defaultReplaceRulesJson 非空时 JSON.parse 校验
 *   3. templateId 锁定（已有版本不允许迁库）
 */
export function TemplateVersionForm({
  initial,
  saving,
  onSubmit,
  onCancel,
}: {
  initial: Partial<TemplateVersion>;
  saving?: boolean;
  onSubmit: (v: TemplateVersionFormValue) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const templateId = initial.templateId ?? null;
  const [version, setVersion] = useState<string>(initial.version ?? "");
  const [description, setDescription] = useState<string>(
    initial.description ?? initial.changelog ?? ""
  );
  const [rulesJson, setRulesJson] = useState<string>(
    initial.defaultReplaceRulesJson ?? ""
  );

  const [templates, setTemplates] = useState<BaseTemplate[]>([]);
  const [errors, setErrors] = useState<{ version?: string; rulesJson?: string }>({});

  // 拉模板列表只为展示模板名（templateId 不可改）
  useEffect(() => {
    let alive = true;
    templateApi
      .list(1, 200)
      .then((r) => {
        if (alive) setTemplates(r.records ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function insertExample() {
    setRulesJson(EXAMPLE_REPLACE_RULES_JSON);
    setErrors((e) => ({ ...e, rulesJson: undefined }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!VERSION_RE.test(version.trim())) {
      next.version = t("templateVersion.form.invalidVersion");
    }
    if (rulesJson.trim()) {
      try {
        JSON.parse(rulesJson);
      } catch {
        next.rulesJson = t("templateVersion.form.invalidJson");
      }
    }
    setErrors(next);
    if (next.version || next.rulesJson) return;

    onSubmit({
      version: version.trim(),
      description,
      defaultReplaceRulesJson: rulesJson.trim(),
    });
  }

  const templateName = (() => {
    const found = templates.find((tt) => tt.id === templateId);
    if (found) return `${found.name} · #${found.id}`;
    return templateId != null ? `#${templateId}` : "-";
  })();

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <div>
        <label className="mb-1 block text-sm font-medium">
          {t("templateVersion.form.name")}
        </label>
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{templateName}</div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          {t("templateVersion.form.version")}
        </label>
        <input
          value={version}
          onChange={(e) => {
            setVersion(e.target.value);
            if (errors.version) setErrors((er) => ({ ...er, version: undefined }));
          }}
          className={inp}
          placeholder={t("templateVersion.form.versionPlaceholder")}
          required
        />
        {errors.version && (
          <div className="mt-1 text-xs text-destructive">{errors.version}</div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          {t("templateVersion.form.description")}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className={inp}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm font-medium">
            {t("templateVersion.form.replaceRulesJson")}
          </label>
          <button
            type="button"
            onClick={insertExample}
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            {t("templateVersion.form.insertExample")}
          </button>
        </div>
        <textarea
          value={rulesJson}
          onChange={(e) => {
            setRulesJson(e.target.value);
            if (errors.rulesJson) setErrors((er) => ({ ...er, rulesJson: undefined }));
          }}
          rows={10}
          spellCheck={false}
          className={inp + " font-mono text-xs"}
          placeholder='{"shop_name": {"from": "BIOU", "to": "{{brand}}"}}'
        />
        <div className="mt-1 text-xs text-muted-foreground">
          {t("templateVersion.form.replaceRulesHint")}
        </div>
        {errors.rulesJson && (
          <div className="mt-1 text-xs text-destructive">{errors.rulesJson}</div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? t("common.loading") : t("common.save")}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border px-4 py-2 text-sm hover:bg-accent"
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
