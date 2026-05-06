"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { templateApi, type BaseTemplate } from "@/lib/api/template";
import { EXAMPLE_REPLACE_RULES_JSON } from "@/lib/api/templateVersion";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/context";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * AS6 · 新建模板版本 = 上传一份带 zip 的初始化模板。
 * 走 W3-TPL-02 的 POST /template/{id}/version 多部分上传 + 钉钉敏感码二次确认。
 */
export default function NewTemplateVersionPage() {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();

  const [templates, setTemplates] = useState<BaseTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateId, setTemplateId] = useState<number | "">("");
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [rulesJson, setRulesJson] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ version?: string; rulesJson?: string; file?: string; templateId?: string }>({});
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let alive = true;
    setTemplatesLoading(true);
    templateApi
      .list(1, 200)
      .then((r) => {
        if (alive) setTemplates(r.records ?? []);
      })
      .catch(() => {})
      .finally(() => alive && setTemplatesLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  function insertExample() {
    setRulesJson(EXAMPLE_REPLACE_RULES_JSON);
    setErrors((e) => ({ ...e, rulesJson: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!templateId) next.templateId = t("templateVersion.form.namePlaceholder");
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
    if (!file) next.file = t("templateVersion.form.zipRequired");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setUploading(true);
    try {
      await templateApi.requestSensitiveCode("TEMPLATE_VERSION_UPLOAD");
      const code = prompt(t("products.dingCodePrompt"));
      if (!code) {
        setUploading(false);
        return;
      }
      const { sensitiveToken } = await templateApi.verifySensitive(
        "TEMPLATE_VERSION_UPLOAD",
        code,
      );
      const newVid = await templateApi.uploadVersion(
        Number(templateId),
        version.trim(),
        file!,
        sensitiveToken,
        {
          changelog: changelog.trim() || undefined,
          defaultReplaceRules: rulesJson.trim() || undefined,
        },
      );
      toast.success(t("templateVersion.saveSuccess"));
      router.push(`/template-versions/${newVid}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/template-versions" className="hover:underline">
          {t("templateVersion.title")}
        </Link>
        <span>/</span>
        <span>{t("templateVersion.create")}</span>
      </div>
      <h1 className="text-2xl font-semibold">{t("templateVersion.create")}</h1>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
        <div>
          <label className="mb-1 block text-sm font-medium">
            {t("templateVersion.form.name")}
          </label>
          <select
            value={templateId}
            onChange={(e) =>
              setTemplateId(e.target.value ? Number(e.target.value) : "")
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
          {errors.templateId && (
            <div className="mt-1 text-xs text-destructive">{errors.templateId}</div>
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
            {t("templateVersion.form.zip")}
          </label>
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              if (errors.file) setErrors((er) => ({ ...er, file: undefined }));
            }}
            className={inp + " file:mr-3 file:rounded file:border file:bg-muted file:px-3 file:py-1 file:text-xs"}
            required
          />
          <div className="mt-1 text-xs text-muted-foreground">
            {t("templateVersion.form.zipHint")}
          </div>
          {errors.file && (
            <div className="mt-1 text-xs text-destructive">{errors.file}</div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            {t("templateVersion.form.description")}
          </label>
          <textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
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
            disabled={uploading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {uploading ? t("common.loading") : t("templateVersion.form.uploadAndCreate")}
          </button>
          <button
            type="button"
            onClick={() => router.push("/template-versions")}
            className="rounded border px-4 py-2 text-sm hover:bg-accent"
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
