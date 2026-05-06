"use client";

// TODO i18n
import { useEffect, useMemo, useRef, useState } from "react";
import {
  productApi,
  type ProductOption,
  type ProductVariant,
  type ProductImage,
} from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";

/**
 * 变体表（参照 Shopify Admin → Product → Variants）。
 *
 * 三段式布局：
 *  1. **选项块**（卡片）：每个 product_option 显示 name + 该选项的全部已用值（chip）。
 *     option_name 缺失时退化为 "选项 1 / 选项 2 / 选项 3"（按 position）。
 *     "+ 添加选项" 当前为占位：后端 ProductOptionController 只暴露 GET，CRUD 待补。
 *  2. **批量操作条**（仅选中 ≥1 时出现）：[价格] / [库存] popover 输入框 + [删除]
 *  3. **变体表**：checkbox · 图 · 变体名 (option1/2/3 拼接) + SKU 副标题 · 价格输入 · 库存输入 · ⋮
 *     价格 / 库存默认就是 input 直接编辑，blur 自动 save —— 不再需要"编辑"按钮。
 *  4. **总库存** 底部行
 *
 * 单行的"改 SKU"放进 ⋮ 菜单（高敏走 @RequireSensitiveOp）；"删除"也在 ⋮。
 */
export function VariantsTable({
  productId,
  variants,
  options,
  images,
  onChange,
}: {
  productId: number;
  variants: ProductVariant[];
  options: ProductOption[];
  images: ProductImage[];
  onChange: () => void;
}) {
  const toast = useToast();
  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // 批量编辑 popover
  const [batchField, setBatchField] = useState<"price" | "inventoryQty" | null>(
    null
  );
  const [batchValue, setBatchValue] = useState("");
  const [batchApplying, setBatchApplying] = useState(false);
  // 行内输入 draft：行 id → 字段 → 字符串值（受控，blur 提交）
  const [drafts, setDrafts] = useState<
    Record<number, { price: string; inventoryQty: string }>
  >({});
  // 行级 ⋮ 菜单的 open id（一次只开一个）
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 初始化 / 同步行 draft（外部 variants 变 → reset）
  useEffect(() => {
    const next: Record<number, { price: string; inventoryQty: string }> = {};
    for (const v of variants) {
      next[v.id] = {
        price: v.price == null ? "" : String(v.price),
        inventoryQty: v.inventoryQty == null ? "" : String(v.inventoryQty),
      };
    }
    setDrafts(next);
  }, [variants]);

  // 点外面关 ⋮ 菜单
  useEffect(() => {
    if (openMenuId == null) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpenMenuId(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenuId]);

  const fallbackImg = images[0]?.src;

  // 总库存
  const totalInventory = useMemo(
    () => variants.reduce((sum, v) => sum + (Number(v.inventoryQty) || 0), 0),
    [variants]
  );

  // 选项块数据：按 position 1/2/3 各取一组（option_name 优先用 product_option，没就退化）
  const optionBlocks = useMemo(() => {
    const optionsByPos = new Map<number, ProductOption>();
    for (const o of options) optionsByPos.set(o.position, o);
    const blocks: { position: number; name: string; values: string[] }[] = [];
    for (const pos of [1, 2, 3] as const) {
      const valueSet = new Set<string>();
      for (const v of variants) {
        const val =
          pos === 1 ? v.option1 : pos === 2 ? v.option2 : v.option3;
        if (val && val.trim()) valueSet.add(val.trim());
      }
      const named = optionsByPos.get(pos);
      if (valueSet.size === 0 && !named) continue;
      blocks.push({
        position: pos,
        name: named?.name ?? `选项 ${pos}`,
        values: [...valueSet],
      });
    }
    return blocks;
  }, [options, variants]);

  // 行选择
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

  // 行 draft 控制
  function setRowField(
    id: number,
    field: "price" | "inventoryQty",
    val: string
  ) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: val } }));
  }
  /** blur 时如有变化则 save 单字段 */
  async function commitRow(v: ProductVariant, field: "price" | "inventoryQty") {
    const d = drafts[v.id];
    if (!d) return;
    const original =
      field === "price"
        ? v.price == null
          ? ""
          : String(v.price)
        : v.inventoryQty == null
          ? ""
          : String(v.inventoryQty);
    if (d[field] === original) return;
    try {
      const patch: Partial<ProductVariant> =
        field === "inventoryQty"
          ? { inventoryQty: Number(d[field]) }
          : { price: d[field] as unknown as number };
      await productApi.variantUpdate(v.id, patch);
      onChange();
    } catch (e) {
      toast.error((e as ApiError).message);
      // 失败回滚 draft
      setDrafts((dr) => ({
        ...dr,
        [v.id]: {
          ...dr[v.id],
          [field]: original,
        },
      }));
    }
  }

  // 行级操作
  async function addNew() {
    try {
      const r = await productApi.variantCreate(productId, {
        position: variants.length + 1,
        sku: `SKU-NEW-${Date.now()}`,
        price: 0 as unknown as number,
        inventoryQty: 1000,
        inventoryPolicy: "continue",
      });
      toast.success(`已新增变体 #${r.id}`);
      onChange();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }
  async function delOne(v: ProductVariant) {
    if (!confirm(`删除变体 #${v.id} (SKU: ${v.sku})？`)) return;
    try {
      await productApi.variantDelete(v.id);
      toast.success("已删除");
      onChange();
    } catch (e) {
      toast.error((e as ApiError).message);
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
      toast.success("SKU 已变更（log 已落 sku_change_log）");
      onChange();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  // 批量
  async function applyBatch() {
    if (!batchField || selectedIds.size === 0) return;
    const raw = batchValue.trim();
    if (raw === "") {
      toast.warn("请输入新值");
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
    if (fail === 0) {
      toast.success(`批量更新${batchField === "price" ? "价格" : "库存"}（${ok}/${ids.length}）`);
    } else {
      toast.error(`部分失败：成功 ${ok}，失败 ${fail}`);
    }
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
    if (fail === 0) {
      toast.success(`已删除 ${ok} 个变体`);
    } else {
      toast.error(`部分失败：成功 ${ok}，失败 ${fail}`);
    }
    setSelectedIds(new Set());
    onChange();
  }

  function variantDisplayName(v: ProductVariant): string {
    const parts = [v.option1, v.option2, v.option3].filter(
      (x) => x && x.trim()
    ) as string[];
    return parts.length > 0 ? parts.join(" / ") : "默认";
  }

  return (
    <section className="space-y-3 rounded-lg border bg-background p-5">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">变体 ({variants.length})</h2>
        <button
          type="button"
          onClick={addNew}
          className="rounded border px-3 py-1 text-xs hover:bg-accent"
        >
          + 新增变体
        </button>
      </div>

      {/* 选项块 */}
      <OptionsBlock blocks={optionBlocks} />

      {/* 批量操作条 */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">已选 {selectedIds.size} 项</span>
          <span className="text-muted-foreground">·</span>
          <BatchBtn
            label="价格"
            active={batchField === "price"}
            onClick={() =>
              setBatchField(batchField === "price" ? null : "price")
            }
          />
          <BatchBtn
            label="库存"
            active={batchField === "inventoryQty"}
            onClick={() =>
              setBatchField(
                batchField === "inventoryQty" ? null : "inventoryQty"
              )
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
                    if (e.key === "Enter" && !batchApplying && batchValue)
                      applyBatch();
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

      {/* 变体表 */}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2.5 text-left">
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
              <th className="px-3 py-2.5 text-left font-medium">变体</th>
              <th className="w-44 px-3 py-2.5 text-left font-medium">
                价格 (USD)
              </th>
              <th className="w-32 px-3 py-2.5 text-left font-medium">库存</th>
              <th className="w-12 px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {variants.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 text-center text-xs text-muted-foreground"
                >
                  暂无变体，点击右上"+ 新增变体"添加。
                </td>
              </tr>
            )}
            {variants.map((v) => {
              const checked = selectedIds.has(v.id);
              const thumb = v.variantImage || fallbackImg;
              const d = drafts[v.id] ?? { price: "", inventoryQty: "" };
              return (
                <tr
                  key={v.id}
                  className={
                    "border-t " + (checked ? "bg-primary/[0.04]" : "")
                  }
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${v.sku || v.id}`}
                      checked={checked}
                      onChange={() => toggleOne(v.id)}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded border object-cover"
                        />
                      ) : (
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded border bg-muted text-[10px] text-muted-foreground">
                          无
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {variantDisplayName(v)}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {v.sku || `#${v.id}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
                      <span className="text-xs text-muted-foreground">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={d.price}
                        onChange={(e) =>
                          setRowField(v.id, "price", e.target.value)
                        }
                        onBlur={() => commitRow(v, "price")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            (e.target as HTMLInputElement).blur();
                        }}
                        className="w-full bg-transparent text-sm focus:outline-none"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      value={d.inventoryQty}
                      onChange={(e) =>
                        setRowField(v.id, "inventoryQty", e.target.value)
                      }
                      onBlur={() => commitRow(v, "inventoryQty")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          (e.target as HTMLInputElement).blur();
                      }}
                      className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {/* 行操作 ⋮ 菜单 */}
                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMenuId(openMenuId === v.id ? null : v.id)
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-accent"
                        aria-label="行操作"
                      >
                        ⋮
                      </button>
                      {openMenuId === v.id && (
                        <div
                          ref={menuRef}
                          className="absolute right-0 top-7 z-10 w-32 rounded-md border bg-background py-1 text-sm shadow-lg"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              changeSku(v);
                            }}
                            className="block w-full px-3 py-1.5 text-left hover:bg-accent"
                          >
                            改 SKU
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              delOne(v);
                            }}
                            className="block w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive/10"
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {variants.length > 0 && (
          <div className="border-t bg-muted/20 px-3 py-2 text-center text-xs text-muted-foreground">
            总库存：<span className="tabular-nums">{totalInventory}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** 选项块：每个 option_name 一行，下方 chips。"+ 添加选项"占位（后端 CRUD 待补）。 */
function OptionsBlock({
  blocks,
}: {
  blocks: { position: number; name: string; values: string[] }[];
}) {
  if (blocks.length === 0) {
    // 没选项：展示空态卡片 + 添加按钮（占位）
    return (
      <div className="rounded-lg border bg-muted/20 p-4">
        <button
          type="button"
          onClick={() =>
            alert("暂未支持 UI 编辑选项；请通过 CSV 导入或在变体行直接填 option1/2/3 字段。后端 CRUD 待 P3 完整化。")
          }
          className="text-sm text-primary hover:underline"
        >
          + 添加选项（如：颜色、尺寸）
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      {blocks.map((b) => (
        <div
          key={b.position}
          className="flex items-start gap-3 rounded-md border bg-background px-3 py-2"
        >
          {/* drag dot 占位（后续接 dnd） */}
          <span className="mt-1 select-none text-xs text-muted-foreground">
            ⋮⋮
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-muted-foreground">
              {b.name}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {b.values.length === 0 ? (
                <span className="text-xs italic text-muted-foreground">
                  （无值）
                </span>
              ) : (
                b.values.map((val) => (
                  <span
                    key={val}
                    className="rounded-md border bg-muted/50 px-2 py-0.5 text-xs"
                  >
                    {val}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          alert("暂未支持 UI 编辑选项；请通过 CSV 导入或在变体行直接填 option1/2/3 字段。后端 CRUD 待 P3 完整化。")
        }
        className="ml-2 text-sm text-primary hover:underline"
      >
        + 添加选项
      </button>
    </div>
  );
}

function BatchBtn({
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
