"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  templateVersionApi,
  type TemplateVersion,
} from "@/lib/api/templateVersion";
import { useToast } from "@/components/ui/Toast";
import { ErrorBanner, LoadingBlock } from "@/components/ui/StatusBlocks";
import { useI18n } from "@/lib/i18n/context";
import { TemplateVersionForm } from "../_components/TemplateVersionForm";

/**
 * AS6 · 编辑模板版本（metadata 部分）。
 */
export default function EditTemplateVersionPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();

  const [data, setData] = useState<TemplateVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await templateVersionApi.detail(id);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (Number.isFinite(id) && id > 0) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return <LoadingBlock />;
  }

  if (error || !data) {
    return <ErrorBanner message={error ?? "not found"} onRetry={load} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/template-versions" className="hover:underline">
          {t("templateVersion.title")}
        </Link>
        <span>/</span>
        <span>
          #{data.id} · {data.version}
        </span>
      </div>
      <h1 className="text-2xl font-semibold">
        {t("templateVersion.edit")} · {data.version}
      </h1>

      <TemplateVersionForm
        mode="edit"
        initial={data}
        saving={saving}
        onCancel={() => router.push("/template-versions")}
        onSubmit={async (v) => {
          setSaving(true);
          try {
            await templateVersionApi.update(id, {
              version: v.version,
              description: v.description,
              defaultReplaceRulesJson: v.defaultReplaceRulesJson,
            });
            toast.success(t("templateVersion.saveSuccess"));
            load();
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
