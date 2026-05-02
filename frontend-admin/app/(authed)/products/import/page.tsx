"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth/store";

type Report = {
  success: number;
  errors: string[];
};

export default function ImportProductsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [companyId, setCompanyId] = useState(1);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError("请选择 CSV 文件");
      return;
    }
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("ownerCompanyId", String(companyId));
      const resp = await fetch("/api/product/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken ?? ""}`,
        },
        body: fd,
      });
      const body = await resp.json();
      if (body.code !== 0) {
        setError(body.message);
      } else {
        setReport(body.data as Report);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">导入产品 CSV</h1>
      <p className="text-sm text-muted-foreground">
        Shopify 标准 42 列 CSV 模板。同 handle 多行（variants/images）会自动聚合。
      </p>

      <form onSubmit={submit} className="space-y-4 rounded-lg border bg-background p-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium">所属分公司 ID</label>
          <input
            type="number"
            value={companyId}
            onChange={(e) => setCompanyId(Number(e.target.value))}
            required
            className="w-32 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">CSV 文件</label>
          <input ref={fileRef} type="file" accept=".csv,text/csv" required className="text-sm" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "导入中..." : "开始导入"}
        </button>
      </form>

      {report && (
        <div className="rounded-lg border bg-background p-5 text-sm">
          <p className="font-medium text-emerald-700">✓ 成功导入 {report.success} 个产品</p>
          {report.errors.length > 0 && (
            <>
              <p className="mt-3 font-medium text-amber-700">失败 {report.errors.length} 条：</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {report.errors.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </>
          )}
          <button
            onClick={() => router.push("/products")}
            className="mt-4 rounded-md border px-4 py-1.5 text-sm hover:bg-accent"
          >
            返回列表
          </button>
        </div>
      )}
    </div>
  );
}
