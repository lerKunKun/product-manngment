"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { productApi } from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";

export default function NewProductPage() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");
  const [ownerCompanyId, setOwnerCompanyId] = useState(1);
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await productApi.create({
        handle: handle.trim(),
        title: title.trim(),
        vendor: vendor || undefined,
        tags: tags || undefined,
        ownerCompanyId,
        status,
        published: status === "active",
      });
      router.push(`/products/${r.id}`);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">新建产品</h1>
      <form onSubmit={submit} className="space-y-5 rounded-lg border bg-background p-5">
        <Field label="Handle（唯一匹配键）">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="my-cool-product"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            仅小写字母 / 数字 / 中划线，全平台唯一
          </p>
        </Field>
        <Field label="标题">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Vendor">
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="所属分公司 ID">
            <input
              type="number"
              value={ownerCompanyId}
              onChange={(e) => setOwnerCompanyId(Number(e.target.value))}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>
        <Field label="Tags（逗号分隔）">
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="summer, sale, new"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="状态">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "draft" | "active" | "archived")}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="draft">草稿（draft）</option>
            <option value="active">上架（active）</option>
            <option value="archived">归档（archived）</option>
          </select>
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "创建中..." : "创建产品"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border px-5 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
