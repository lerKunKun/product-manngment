"use client";

// TODO i18n
import { useState } from "react";
import {
  productApi,
  type ProductOption,
  type ProductVariant,
  type ProductImage,
} from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";

const inpSm =
  "rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * 变体表。
 * 列头按 product_option.position **升序**动态展示（"颜色 / 尺寸 / 材质"），
 * 之后是 Price / SKU / 库存 / 操作。
 *
 * <p>每行 cell 从 variant.option1 / option2 / option3 取，按 option.position
 * 对应：position=1 → option1，position=2 → option2，position=3 → option3。
 */
export function VariantsTable({
  productId,
  variants,
  options,
  images,
  onChange,
  onMessage,
}: {
  productId: number;
  variants: ProductVariant[];
  options: ProductOption[];
  images: ProductImage[];
  onChange: () => void;
  onMessage: (msg: string) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<ProductVariant>>({});

  // option name 列头：按 position 升序，最多 3 列（schema 上限）
  const optionCols = [...options]
    .sort((a, b) => a.position - b.position)
    .slice(0, 3);

  // 第一张图片当做缩略图（无 variant_image 时回退）
  const fallbackImg = images[0]?.src;

  function variantOptionValue(v: ProductVariant, position: number): string {
    if (position === 1) return v.option1 ?? "";
    if (position === 2) return v.option2 ?? "";
    if (position === 3) return v.option3 ?? "";
    return "";
  }
  function setDraftOptionValue(position: number, value: string) {
    if (position === 1) setDraft((d) => ({ ...d, option1: value }));
    else if (position === 2) setDraft((d) => ({ ...d, option2: value }));
    else if (position === 3) setDraft((d) => ({ ...d, option3: value }));
  }

  async function save() {
    if (!editing) return;
    try {
      await productApi.variantUpdate(editing, draft);
      onMessage("✓ 变体已保存");
      setEditing(null);
      setDraft({});
      onChange();
    } catch (e) {
      onMessage((e as ApiError).message);
    }
  }
  async function addNew() {
    try {
      const r = await productApi.variantCreate(productId, {
        position: variants.length + 1,
        sku: `SKU-NEW-${Date.now()}`,
        price: 0 as unknown as number,
        inventoryQty: 1000,
        inventoryPolicy: "continue",
      });
      onMessage(`✓ 已新增变体 #${r.id}`);
      onChange();
    } catch (e) {
      onMessage((e as ApiError).message);
    }
  }
  async function del(v: ProductVariant) {
    if (!confirm(`删除变体 #${v.id} (SKU: ${v.sku})？`)) return;
    try {
      await productApi.variantDelete(v.id);
      onMessage("✓ 已删除");
      onChange();
    } catch (e) {
      onMessage((e as ApiError).message);
    }
  }
  async function changeSku(v: ProductVariant) {
    const newSku = prompt(`新 SKU（当前 ${v.sku}）：`, v.sku ?? "");
    if (!newSku || newSku === v.sku) return;
    try {
      await productApi.requestSensitiveCode("PURCHASE_SKU_EDIT");
      const code = prompt("钉钉收到的 6 位验证码：");
      if (!code) return;
      const { sensitiveToken } = await productApi.verifySensitive(
        "PURCHASE_SKU_EDIT",
        code
      );
      await productApi.changeSku(v.id, newSku, sensitiveToken);
      onMessage("✓ SKU 已变更（log 已落 sku_change_log）");
      onChange();
    } catch (e) {
      onMessage((e as ApiError).message);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">变体 ({variants.length})</h2>
        <button
          onClick={addNew}
          className="rounded border px-3 py-1 text-xs hover:bg-accent"
        >
          + 新增变体
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">图</th>
              {/* 动态 option 列头 */}
              {optionCols.length === 0 ? (
                <th className="px-2 py-2 text-left">选项</th>
              ) : (
                optionCols.map((o) => (
                  <th key={o.id} className="px-2 py-2 text-left">
                    {o.name}
                  </th>
                ))
              )}
              <th className="px-2 py-2 text-right">价格 (USD)</th>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-right">库存</th>
              <th className="px-2 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {variants.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(optionCols.length, 1) + 5}
                  className="py-6 text-center text-xs text-muted-foreground"
                >
                  暂无变体
                </td>
              </tr>
            )}
            {variants.map((v) => {
              const isEdit = editing === v.id;
              const thumb = v.variantImage || fallbackImg;
              return (
                <tr
                  key={v.id}
                  className={"border-t " + (isEdit ? "bg-primary/5" : "")}
                >
                  <td className="px-2 py-2">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        className="h-10 w-10 rounded border object-cover"
                      />
                    ) : (
                      <div className="grid h-10 w-10 place-items-center rounded border bg-muted text-[10px] text-muted-foreground">
                        无
                      </div>
                    )}
                  </td>

                  {optionCols.length === 0 ? (
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      —
                    </td>
                  ) : (
                    optionCols.map((o) =>
                      isEdit ? (
                        <td key={o.id} className="px-2 py-2">
                          <input
                            value={variantOptionValue(
                              draft as ProductVariant,
                              o.position
                            )}
                            onChange={(e) =>
                              setDraftOptionValue(o.position, e.target.value)
                            }
                            className={inpSm + " w-28"}
                            placeholder={o.name}
                          />
                        </td>
                      ) : (
                        <td key={o.id} className="px-2 py-2">
                          {variantOptionValue(v, o.position) || "-"}
                        </td>
                      )
                    )
                  )}

                  <td className="px-2 py-2 text-right">
                    {isEdit ? (
                      <div className="inline-flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={String(draft.price ?? 0)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              price: e.target.value as unknown as number,
                            })
                          }
                          className={inpSm + " w-24 text-right"}
                        />
                      </div>
                    ) : v.price != null ? (
                      `$${Number(v.price).toFixed(2)}`
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">
                    {v.sku || "-"}
                    {isEdit && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        SKU 用「改 SKU」专用按钮
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {isEdit ? (
                      <input
                        type="number"
                        value={draft.inventoryQty ?? 0}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            inventoryQty: Number(e.target.value),
                          })
                        }
                        className={inpSm + " w-20 text-right"}
                      />
                    ) : (
                      v.inventoryQty ?? 0
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {isEdit ? (
                      <>
                        <button
                          onClick={save}
                          className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => {
                            setEditing(null);
                            setDraft({});
                          }}
                          className="rounded border px-2 py-1 text-xs hover:bg-accent"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditing(v.id);
                            setDraft(v);
                          }}
                          className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => changeSku(v)}
                          className="mr-1 rounded border px-2 py-1 text-xs hover:bg-accent"
                        >
                          改 SKU
                        </button>
                        <button
                          onClick={() => del(v)}
                          className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                        >
                          删除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
