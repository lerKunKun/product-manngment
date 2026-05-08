"use client";

// 完整权限矩阵：按 module 分组（PERMISSION_MODULES 顺序），模块批量勾选 / 折叠 / 过滤。
// 从老 /admin/role/page.tsx 的 PermissionMatrix 抽出，包成 dialog。

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SensitiveActionDialog } from "@/components/SensitiveActionDialog";
import { roleApi, type RoleDetail } from "@/lib/api/role";
import {
  ALL_PERMISSION_CODES,
  PERMISSION_META,
  PERMISSION_MODULES,
  moduleLabel,
  permissionLabel,
} from "@/lib/i18n/permissions";
import type { ApiError } from "@/lib/api/client";

export function PermissionMatrixDialog({
  open,
  roleId,
  onClose,
  onChanged,
}: {
  open: boolean;
  roleId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<RoleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  // ---- 加载 ----
  useEffect(() => {
    if (!open) return;
    if (!roleId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setFilter("");
    setCollapsed({});
    (async () => {
      try {
        const d = await roleApi.get(roleId);
        setDetail(d);
        setSelected(new Set(d.permissionCodes));
      } catch (e) {
        toast.error((e as ApiError).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, roleId, toast]);

  // ---- 派生 ----

  // 全集 = 字典登记的 ∪ 当前角色已有的（防止后端冒出未登记 code 时丢失）
  const grouped = useMemo(() => {
    const all = new Set<string>(ALL_PERMISSION_CODES);
    for (const c of detail?.permissionCodes ?? []) all.add(c);
    const g: Record<string, string[]> = {};
    for (const m of Object.keys(PERMISSION_MODULES)) g[m] = [];
    for (const c of all) {
      const m = PERMISSION_META[c]?.module ?? "_other";
      (g[m] ??= []).push(c);
    }
    for (const m of Object.keys(g)) g[m].sort();
    for (const m of Object.keys(g)) if (g[m].length === 0) delete g[m];
    return g;
  }, [detail]);

  const totalCount = useMemo(
    () => Object.values(grouped).reduce((s, a) => s + a.length, 0),
    [grouped]
  );

  // 过滤（搜索 code 或中文）
  const visible = useMemo(() => {
    if (!filter.trim()) return grouped;
    const q = filter.trim().toLowerCase();
    const out: Record<string, string[]> = {};
    for (const [m, codes] of Object.entries(grouped)) {
      const hits = codes.filter(
        (c) =>
          c.toLowerCase().includes(q) ||
          permissionLabel(c, "zh").toLowerCase().includes(q) ||
          moduleLabel(m, "zh").toLowerCase().includes(q)
      );
      if (hits.length > 0) out[m] = hits;
    }
    return out;
  }, [grouped, filter]);

  const builtin = detail?.role.builtin ?? false;
  const dirty = useMemo(() => {
    const orig = new Set(detail?.permissionCodes ?? []);
    if (orig.size !== selected.size) return true;
    for (const c of selected) if (!orig.has(c)) return true;
    return false;
  }, [detail, selected]);

  // ---- 交互 ----

  function toggle(code: string) {
    if (builtin) return;
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleModule(codes: string[], allOwned: boolean) {
    if (builtin) return;
    setSelected((s) => {
      const next = new Set(s);
      for (const c of codes) {
        if (allOwned) next.delete(c);
        else next.add(c);
      }
      return next;
    });
  }

  function selectAll() {
    if (builtin) return;
    const next = new Set<string>();
    for (const codes of Object.values(grouped)) for (const c of codes) next.add(c);
    setSelected(next);
  }
  function clearAll() {
    if (builtin) return;
    setSelected(new Set());
  }
  function reset() {
    setSelected(new Set(detail?.permissionCodes ?? []));
  }

  function save() {
    if (!detail || builtin || !dirty) return;
    // 后端 @RequireSensitiveOp("ROLE_PERMISSION_CHANGE") 必须 step-up
    setStepUpOpen(true);
  }

  async function onStepUpConfirmed(token: string) {
    if (!detail) return;
    setSaving(true);
    try {
      await roleApi.updatePermissions(detail.role.id, Array.from(selected), token);
      toast.success("权限已保存");
      onChanged();
      onClose();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSaving(false);
      setStepUpOpen(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={detail ? `权限矩阵 · ${detail.role.name}` : "权限矩阵"}
      className="max-w-4xl"
    >
      {!roleId ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          未选中角色。请在左侧角色卡片上点 ⋯ → 编辑权限。
        </p>
      ) : loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">加载中...</p>
      ) : !detail ? (
        <p className="py-6 text-center text-sm text-muted-foreground">未找到</p>
      ) : (
        <div className="space-y-3">
          {/* 顶部状态栏 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                已选 {selected.size} / {totalCount} 项
              </span>
              {builtin && <Badge variant="warning">内置不可改</Badge>}
              {!builtin && dirty && <Badge variant="warning">未保存</Badge>}
            </div>
            <div className="flex items-center gap-1.5">
              {!builtin && (
                <>
                  <button
                    type="button"
                    onClick={selectAll}
                    className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    disabled={!dirty}
                    className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    撤销
                  </button>
                </>
              )}
            </div>
          </div>

          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="按模块名 / 权限码 / 中文描述过滤"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {/* 模块分组 */}
          <div className="max-h-[55vh] space-y-2 overflow-auto">
            {Object.entries(visible).length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                无匹配项
              </p>
            )}
            {Object.entries(visible).map(([m, codes]) => {
              const ownedInMod = codes.filter((c) => selected.has(c)).length;
              const allOwned = ownedInMod === codes.length;
              const someOwned = ownedInMod > 0 && !allOwned;
              const isCollapsed = !!collapsed[m];
              return (
                <div key={m} className="rounded-md border">
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => setCollapsed((p) => ({ ...p, [m]: !p[m] }))}
                      className="flex items-center gap-1.5 text-sm font-medium"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      <span>{moduleLabel(m, "zh")}</span>
                      <span className="text-[10px] text-muted-foreground">
                        ({ownedInMod}/{codes.length})
                      </span>
                    </button>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        disabled={builtin}
                        checked={allOwned}
                        ref={(el) => {
                          if (el) el.indeterminate = someOwned;
                        }}
                        onChange={() => toggleModule(codes, allOwned)}
                      />
                      整组
                    </label>
                  </div>
                  {!isCollapsed && (
                    <table className="w-full text-sm">
                      <tbody>
                        {codes.map((c) => (
                          <tr
                            key={c}
                            className="border-b last:border-0 hover:bg-accent/30"
                          >
                            <td className="w-8 px-3 py-1">
                              <input
                                type="checkbox"
                                disabled={builtin}
                                checked={selected.has(c)}
                                onChange={() => toggle(c)}
                              />
                            </td>
                            <td className="px-3 py-1">
                              <div className="font-mono text-xs">{c}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {permissionLabel(c, "zh")}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              取消
            </button>
            <button
              type="button"
              disabled={builtin || !dirty || saving}
              onClick={save}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}
      <SensitiveActionDialog
        open={stepUpOpen}
        action="ROLE_PERMISSION_CHANGE"
        description={
          detail
            ? `修改角色「${detail.role.name}」的权限（${selected.size} 项）`
            : ""
        }
        onClose={() => setStepUpOpen(false)}
        onConfirmed={onStepUpConfirmed}
      />
    </Dialog>
  );
}
