"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { templateVersionApi } from "@/lib/api/templateVersion";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/context";
import { TemplateVersionForm } from "../_components/TemplateVersionForm";

/**
 * AS6 · 新建模板版本（metadata 部分；zip 上传仍走 /templates/[id]）。
 */
export default function NewTemplateVersionPage() {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

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

      <TemplateVersionForm
        mode="create"
        saving={saving}
        onCancel={() => router.push("/template-versions")}
        onSubmit={async (v) => {
          if (!v.templateId) return;
          setSaving(true);
          try {
            const id = await templateVersionApi.create({
              templateId: v.templateId,
              version: v.version,
              description: v.description || undefined,
              defaultReplaceRulesJson: v.defaultReplaceRulesJson || undefined,
            });
            toast.success(t("templateVersion.saveSuccess"));
            router.push(`/template-versions/${id}`);
          } catch {
            // 全局 toast 已上报
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}
