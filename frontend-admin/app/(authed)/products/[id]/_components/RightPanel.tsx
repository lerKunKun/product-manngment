"use client";

// TODO i18n
import { useEffect, useState } from "react";
import {
  productApi,
  type Product,
  type ProductMetafield,
} from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";
import { Badge } from "@/components/ui/Badge";

const STATUS_VARIANT: Record<Product["status"], "success" | "warning" | "neutral"> = {
  active: "success",
  draft: "warning",
  archived: "neutral",
};
const STATUS_LABEL: Record<Product["status"], string> = {
  active: "已上架",
  draft: "草稿",
  archived: "已归档",
};

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function RightPanel({
  productId,
  product,
  onProductPatch,
  onMessage,
}: {
  productId: number;
  product: Product;
  /** 父组件保存到后端后会重新 load；这里只更新本地草稿。 */
  onProductPatch: (patch: Partial<Product>) => void;
  onMessage: (msg: string) => void;
}) {
  return (
    <aside className="space-y-4">
      <StatusCard product={product} onProductPatch={onProductPatch} />
      <OrganizationCard product={product} onProductPatch={onProductPatch} />
      <MetafieldsCard productId={productId} onMessage={onMessage} />
    </aside>
  );
}

function StatusCard({
  product,
  onProductPatch,
}: {
  product: Product;
  onProductPatch: (patch: Partial<Product>) => void;
}) {
  const variant = STATUS_VARIANT[product.status];
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        Status
      </h3>
      <div className="flex items-center gap-2">
        <Badge variant={variant}>{STATUS_LABEL[product.status]}</Badge>
      </div>
      <select
        value={product.status}
        onChange={(e) =>
          onProductPatch({
            status: e.target.value as Product["status"],
            published: e.target.value === "active",
          })
        }
        className={inp}
      >
        <option value="draft">草稿</option>
        <option value="active">上架</option>
        <option value="archived">归档</option>
      </select>
    </section>
  );
}

function OrganizationCard({
  product,
  onProductPatch,
}: {
  product: Product;
  onProductPatch: (patch: Partial<Product>) => void;
}) {
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        产品组织
      </h3>
      <div>
        <label className="mb-1 block text-xs font-medium">Vendor</label>
        <input
          value={product.vendor ?? ""}
          onChange={(e) => onProductPatch({ vendor: e.target.value })}
          className={inp}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">Product type</label>
        <input
          value={product.type ?? ""}
          onChange={(e) => onProductPatch({ type: e.target.value })}
          className={inp}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">
          Tags（逗号分隔）
        </label>
        <input
          value={product.tags ?? ""}
          onChange={(e) => onProductPatch({ tags: e.target.value })}
          className={inp}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">分类 / Category</label>
        <input
          value={product.productCategory ?? ""}
          onChange={(e) => onProductPatch({ productCategory: e.target.value })}
          className={inp}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        注：Collections 关联在 Wave 后续接 collection_product 中间表，目前从 tags 推导
      </p>
    </section>
  );
}

function MetafieldsCard({
  productId,
  onMessage,
}: {
  productId: number;
  onMessage: (msg: string) => void;
}) {
  const [list, setList] = useState<ProductMetafield[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{
    namespace: string;
    key: string;
    value: string;
    type: string;
  }>({ namespace: "custom", key: "", value: "", type: "single_line_text_field" });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setList(await productApi.metafieldList(productId));
    } catch (e) {
      onMessage((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function add() {
    if (!draft.namespace.trim() || !draft.key.trim()) {
      onMessage("namespace 和 key 必填");
      return;
    }
    setBusy(true);
    try {
      await productApi.metafieldCreate(productId, draft);
      onMessage("✓ metafield 已添加");
      setDraft({ ...draft, key: "", value: "" });
      load();
    } catch (e) {
      onMessage((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  async function del(id: number) {
    if (!confirm("删除该 metafield？")) return;
    try {
      await productApi.metafieldDelete(id);
      load();
    } catch (e) {
      onMessage((e as ApiError).message);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        Metafields
      </h3>

      {loading ? (
        <p className="text-xs text-muted-foreground">加载中...</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无 metafield</p>
      ) : (
        <ul className="space-y-2">
          {list.map((m) => (
            <li
              key={m.id}
              className="rounded border bg-muted/20 p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono">
                  {m.namespace}.{m.key}
                </span>
                <button
                  onClick={() => del(m.id)}
                  className="text-[10px] text-destructive hover:underline"
                >
                  删除
                </button>
              </div>
              <div className="mt-1 truncate text-muted-foreground">
                {m.value || <span className="italic">（空）</span>}
              </div>
              {m.type && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  type: {m.type}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5 border-t pt-3 text-xs">
        <div className="grid grid-cols-2 gap-1.5">
          <input
            value={draft.namespace}
            onChange={(e) => setDraft({ ...draft, namespace: e.target.value })}
            placeholder="namespace"
            className="rounded border bg-background px-2 py-1"
          />
          <input
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            placeholder="key"
            className="rounded border bg-background px-2 py-1"
          />
        </div>
        <input
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          placeholder="value"
          className="w-full rounded border bg-background px-2 py-1"
        />
        <input
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          placeholder="type (e.g. single_line_text_field)"
          className="w-full rounded border bg-background px-2 py-1"
        />
        <button
          onClick={add}
          disabled={busy}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          + 添加 metafield
        </button>
      </div>
    </section>
  );
}
