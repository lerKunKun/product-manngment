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
  templateId: number | null;
  version: string;
  description: string;
  defaultReplaceRulesJson: string;
};

/**
 * AS6 · 模板版本新建 / 编辑共享表单。
 *
 * <p>新建模式：templateId 必选 + 版本号 + 描述 + JSON。
 * 编辑模式：templateId 锁定（已有版本不允许迁库），其它字段可改。
 *
 * <p>提交前在客户端做：
 *   1. version 走 semver-ish 校验
 *   2. defaultReplaceRulesJson 非空时 JSON.parse 校验
 *   3. 校验失败抛错给上层 toast
 */
export function TemplateVersionForm({
  mode,
  initial,
  saving,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: Partial<TemplateVersion> | null;
  saving?: boolean;
  onSubmit: (v: TemplateVersionFormValue) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [templateId, setTemplateId] = useState<number | null>(
    initial?.templateId ?? null
  );
  const [version, setVersion] = useState<string>(initial?.version ?? "");
  const [description, setDescription] = useState<string>(
    initial?.description ?? initial?.changelog ?? ""
  );
  const [rulesJson, setRulesJson] = useState<string>(
    initial?.defaultReplaceRulesJson ?? ""
  );

  const [templates, setTemplates] = useState<BaseTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [errors, setErrors] = useState<{ version?: string; rulesJson?: string }>({});

  // 拉模板下拉（取所有，最多 200，足够日常使用）
  useEffect(() => {
    let alive = true;
    setTemplatesLoading(true);
    templateApi
      .list(1, 200)
      .then((r) => {
        if (alive) setTemplates(r.records ?? []);
      })
      .catch(() => {
        // toast 已上报
      })
      .finally(() => alive && setTemplatesLoading(false));
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
    if (mode === "create" && !templateId) {
      // 必选模板
      next.version = next.version ?? t("templateVersion.form.namePlaceholder");
    }
    setErrors(next);
    if (next.version || next.rulesJson) return;

    onSubmit({
      templateId,
      version: version.trim(),
      description,
      defaultReplaceRulesJson: rulesJson.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      <div>
        <label className="mb-1 block text-sm font-medium">
          {t("templateVersion.form.name")}
        </label>
        {mode === "edit" ? (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {(() => {
              const found = templates.find((tt) => tt.id === templateId);
              if (found) return `${found.name} · #${found.id}`;
              return templateId != null ? `#${templateId}` : "-";
            })()}
          </div>
        ) : (
          <select
            value={templateId ?? ""}
            onChange={(e) =>
              setTemplateId(e.target.value ? Number(e.target.value) : null)
            }
            className={inp}
            disabled={templatesLoading}
            required
          >
            <option value="">{t("templateVersion.form.namePlaceholder")}</option>
            {templates.map((tt) => (
              <option key={tt.id} value={tt.id}>
                {tt.name} · #{tt.id} ({tt.code})
              </option>
            ))}
          </select>
        )}
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
