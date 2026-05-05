"use client";

// TODO i18n
import { useMemo, useState } from "react";
import {
  productApi,
  type ProductOption,
  type ProductVariant,
  type ProductImage,
} from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";

const inpSm =
  "rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type BatchField = "price" | "inventoryQty";

/**
 * 变体表（Shopify 风格批量编辑）。
 *
 * 列头按 product_option.position **升序**动态展示（"颜色 / 尺寸 / 材质"），
 * 之后是 Price / SKU / 库存 / 操作。
 *
 * 交互：
 *  - 每行 checkbox + 表头全选；选中 ≥1 时顶部出现批量操作条
 *  - 批量改 价格 / 库存 → popover 输入新值 → 循环 variantUpdate
 *  - 批量删除 → confirm 后循环 variantDelete
 *  - 单行编辑（编辑 / 改 SKU / 删除）保留旧逻辑
 *
 * 后端没批量端点；几十条产品变体规模下前端串行循环可接受，进度条 / partial
 * 失败汇报由 onMessage 拼接成功 / 失败计数。
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
  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // 批量编辑 popover：'price' / 'inventoryQty' / null
  const [batchField, setBatchField] = useState<BatchField | null>(null);
  const [batchValue, setBatchValue] = useState("");
  const [batchApplying, setBatchApplying] = useState(false);

  // option name 列头：按 position 升序，最多 3 列（schema 上限）
  const optionCols = useMemo(
    () => [...options].sort((a, b) => a.position - b.position).slice(0, 3),
    [options]
  );
  const fallbackImg = images[0]?.src;

  const allChecked =
    variants.length > 0 && selectedIds.size === variants.length;
  const indeterminate =
    selectedIds.size > 0 && selectedIds.size < variants.length;

  function toggleAll() {
    if (allChecked) setSelectedIds(new Set());
    else setSelectedIds(new Set(variants.map((v) => v.id)));
  }
  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setBatchField(null);
    setBatchValue("");
  }

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

  // ===== 批量操作 =====

  /** 串行循环调单行 update；汇总成功 / 失败计数。 */
  async function applyBatch() {
    if (!batchField || selectedIds.size === 0) return;
    const raw = batchValue.trim();
    if (raw === "") {
      onMessage("请输入新值");
      return;
    }
    const ids = [...selectedIds];
    setBatchApplying(true);
    let ok = 0;
    let fail = 0;
    const patch: Partial<ProductVariant> =
      batchField === "inventoryQty"
        ? { inventoryQty: Number(raw) }
        : { price: raw as unknown as number };
    for (const id of ids) {
      try {
        await productApi.variantUpdate(id, patch);
        ok++;
      } catch {
        fail++;
      }
    }
    setBatchApplying(false);
    onMessage(
      fail === 0
        ? `✓ 批量更新 ${batchField === "price" ? "价格" : "库存"}（${ok}/${ids.length}）`
        : `批量更新部分失败：成功 ${ok}，失败 ${fail}`
    );
    setBatchField(null);
    setBatchValue("");
    setSelectedIds(new Set());
    onChange();
  }

  async function batchDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`删除 ${ids.length} 个变体？此操作不可撤销。`)) return;
    setBatchApplying(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await productApi.variantDelete(id);
        ok++;
      } catch {
        fail++;
      }
    }
    setBatchApplying(false);
    onMessage(
      fail === 0
        ? `✓ 已删除 ${ok} 个变体`
        : `批量删除部分失败：成功 ${ok}，失败 ${fail}`
    );
    setSelectedIds(new Set());
    onChange();
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

      {/* Shopify 风格批量操作条：选中 ≥1 时显示，固定在表上方 */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">已选 {selectedIds.size} 项</span>
          <span className="text-muted-foreground">·</span>

          <BatchButton
            label="价格"
            active={batchField === "price"}
            onClick={() =>
              setBatchField(batchField === "price" ? null : "price")
            }
          />
          <BatchButton
            label="库存"
            active={batchField === "inventoryQty"}
            onClick={() =>
              setBatchField(batchField === "inventoryQty" ? null : "inventoryQty")
            }
          />
          <button
            type="button"
            disabled={batchApplying}
            onClick={batchDelete}
            className="rounded border border-destructive px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            删除
          </button>

          <div className="ml-auto flex items-center gap-2">
            {batchField && (
              <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1">
                <span className="text-xs text-muted-foreground">
                  {batchField === "price" ? "新价格 $" : "新库存"}
                </span>
                <input
                  type="number"
                  step={batchField === "price" ? "0.01" : "1"}
                  value={batchValue}
                  onChange={(e) => setBatchValue(e.target.value)}
                  autoFocus
                  className="w-24 bg-transparent text-sm focus:outline-none"
                  placeholder={batchField === "price" ? "29.99" : "1000"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !batchApplying && batchValue) applyBatch();
                  }}
                />
                <button
                  type="button"
                  onClick={applyBatch}
                  disabled={batchApplying || !batchValue}
                  className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {batchApplying ? "..." : "应用"}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-muted-foreground hover:underline"
            >
              取消选择
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-10 px-2 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label="全选"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = indeterminate;
                  }}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-2 py-2 text-left">图</th>
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
                  colSpan={Math.max(optionCols.length, 1) + 6}
                  className="py-6 text-center text-xs text-muted-foreground"
                >
                  暂无变体
                </td>
              </tr>
            )}
            {variants.map((v) => {
              const isEdit = editing === v.id;
              const checked = selectedIds.has(v.id);
              const thumb = v.variantImage || fallbackImg;
              return (
                <tr
                  key={v.id}
                  className={
                    "border-t " +
                    (isEdit
                      ? "bg-primary/5"
                      : checked
                        ? "bg-primary/[0.03]"
                        : "")
                  }
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`选择变体 ${v.sku || v.id}`}
                      checked={checked}
                      onChange={() => toggleOne(v.id)}
                    />
                  </td>
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

function BatchButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded border px-2.5 py-1 text-xs transition-colors " +
        (active
          ? "border-primary bg-primary text-primary-foreground"
          : "hover:bg-accent")
      }
    >
      {label}
    </button>
  );
}
