"use client";

// 左列节点 ⋯ 触发；展示组织详情 + 钉钉配置 + 同步 + 重命名 + 删除（COMPANY 才有钉钉块）。
// phase-2：从 /orgs/page.tsx 搬迁完整 ding 配置表单 / 敏感操作 step-up。当前先放最常用动作。

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { SensitiveActionDialog } from "@/components/SensitiveActionDialog";
import {
  orgApi,
  type DingtalkConfigInput,
  type DingtalkConfigView,
  type SysOrg,
} from "@/lib/api/org";
import type { ApiError } from "@/lib/api/client";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function OrgDetailSheet({
  orgId,
  onClose,
  onChanged,
}: {
  orgId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const open = orgId != null;
  const [detail, setDetail] = useState<SysOrg | null>(null);
  const [loading, setLoading] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  // 钉钉
  const [ding, setDing] = useState<DingtalkConfigView | null>(null);
  const [dingForm, setDingForm] = useState<DingtalkConfigInput>({
    corpId: "",
    appKey: "",
    appSecret: "",
    agentId: "",
    eventToken: "",
    eventAesKey: "",
  });
  const [savingDing, setSavingDing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleteStepUpOpen, setDeleteStepUpOpen] = useState(false);

  useEffect(() => {
    if (!open || !orgId) return;
    setLoading(true);
    setDetail(null);
    setDing(null);
    (async () => {
      try {
        const all = await orgApi.list();
        const o = all.find((x) => x.id === orgId);
        setDetail(o ?? null);
        setRenameVal(o?.name ?? "");
        if (o?.type?.toUpperCase() === "COMPANY") {
          try {
            const d = await orgApi.getDingtalkConfig(orgId);
            setDing(d);
            setDingForm({
              corpId: d.corpId ?? "",
              appKey: d.appKey ?? "",
              appSecret: "",
              agentId: d.agentId ?? "",
              eventToken: d.eventToken ?? "",
              eventAesKey: d.eventAesKey ?? "",
            });
          } catch {
            // 没配置也没关系
          }
        }
      } catch (e) {
        toast.error((e as ApiError).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, orgId, toast]);

  async function rename() {
    if (!orgId || !renameVal.trim() || renameVal.trim() === detail?.name) return;
    try {
      await orgApi.update(orgId, { name: renameVal.trim() });
      toast.success("已重命名");
      onChanged();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  function startDelete() {
    if (!orgId || !detail) return;
    if (!confirm(`确认删除「${detail.name}」？该操作不可逆。`)) return;
    setDeleteStepUpOpen(true);
  }

  async function onDeleteConfirmed(token: string) {
    if (!orgId) return;
    try {
      await orgApi.remove(orgId, token);
      toast.success("已删除");
      onChanged();
      onClose();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setDeleteStepUpOpen(false);
    }
  }

  async function saveDing() {
    if (!orgId) return;
    setSavingDing(true);
    try {
      // appSecret 留空表示不更新
      const payload: DingtalkConfigInput = { ...dingForm };
      if (!payload.appSecret) payload.appSecret = undefined;
      await orgApi.saveDingtalkConfig(orgId, payload);
      toast.success("钉钉配置已保存");
      const d = await orgApi.getDingtalkConfig(orgId);
      setDing(d);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSavingDing(false);
    }
  }

  async function triggerSync() {
    if (!orgId) return;
    setSyncing(true);
    try {
      const r = await orgApi.triggerSync(orgId);
      toast.success(
        `同步完成：新增 ${r.added} / 跳过 ${r.skipped} / 失败 ${r.failed}`
      );
      onChanged();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetHeader>
        <SheetTitle>组织详情</SheetTitle>
        <p className="text-xs text-muted-foreground">
          {detail?.type ?? "—"} · ID {orgId}
        </p>
      </SheetHeader>
      <SheetContent>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">加载中...</p>
        ) : !detail ? (
          <p className="py-6 text-center text-sm text-muted-foreground">未找到</p>
        ) : (
          <div className="space-y-5">
            {/* 基础 */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">基础</h3>
              <div className="flex gap-2">
                <input
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  className={inp}
                />
                <button
                  type="button"
                  onClick={rename}
                  className="rounded-md border px-3 py-2 text-xs hover:bg-accent"
                >
                  改名
                </button>
              </div>
              <div className="text-xs text-muted-foreground">
                code: {detail.code ?? "—"} · parentId: {detail.parentId ?? "—"} · 创建于{" "}
                {detail.createdAt ? new Date(detail.createdAt).toLocaleString("zh-CN") : "—"}
              </div>
            </section>

            {/* 钉钉配置 + 同步：只对 COMPANY 显示 */}
            {detail.type?.toUpperCase() === "COMPANY" && (
              <section className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">钉钉配置</h3>
                  <span className="text-[10px] text-muted-foreground">
                    {ding?.configured ? "✓ 已配置" : "未配置"}
                    {ding?.updatedAt && (
                      <>
                        {" "}
                        · {new Date(ding.updatedAt).toLocaleString("zh-CN")}
                      </>
                    )}
                  </span>
                </div>
                <Field label="corpId">
                  <input
                    value={dingForm.corpId}
                    onChange={(e) => setDingForm({ ...dingForm, corpId: e.target.value })}
                    className={inp}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="appKey">
                    <input
                      value={dingForm.appKey}
                      onChange={(e) => setDingForm({ ...dingForm, appKey: e.target.value })}
                      className={inp}
                    />
                  </Field>
                  <Field label="agentId">
                    <input
                      value={dingForm.agentId}
                      onChange={(e) => setDingForm({ ...dingForm, agentId: e.target.value })}
                      className={inp}
                    />
                  </Field>
                </div>
                <Field label={ding?.configured ? "appSecret（留空不更新）" : "appSecret"}>
                  <input
                    type="password"
                    value={dingForm.appSecret ?? ""}
                    onChange={(e) =>
                      setDingForm({ ...dingForm, appSecret: e.target.value })
                    }
                    className={inp}
                    placeholder={ding?.configured ? "***（留空不更新）" : ""}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="eventToken（可选）">
                    <input
                      value={dingForm.eventToken ?? ""}
                      onChange={(e) =>
                        setDingForm({ ...dingForm, eventToken: e.target.value })
                      }
                      className={inp}
                    />
                  </Field>
                  <Field label="eventAesKey（可选）">
                    <input
                      value={dingForm.eventAesKey ?? ""}
                      onChange={(e) =>
                        setDingForm({ ...dingForm, eventAesKey: e.target.value })
                      }
                      className={inp}
                    />
                  </Field>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={saveDing}
                    disabled={savingDing}
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    {savingDing ? "保存中..." : "保存配置"}
                  </button>
                  <button
                    type="button"
                    onClick={triggerSync}
                    disabled={!ding?.configured || syncing}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                  >
                    {syncing ? "同步中..." : "立即同步"}
                  </button>
                </div>
              </section>
            )}

            {/* 危险区 */}
            <section className="space-y-2 rounded-md border border-red-100 bg-red-50/30 p-3">
              <h3 className="text-sm font-medium text-red-700">危险操作</h3>
              <button
                type="button"
                onClick={startDelete}
                className="rounded-md border border-red-200 bg-background px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                删除该组织
              </button>
            </section>
          </div>
        )}
      </SheetContent>
      <SheetFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-4 py-1.5 text-sm hover:bg-accent"
        >
          关闭
        </button>
      </SheetFooter>
      <SensitiveActionDialog
        open={deleteStepUpOpen}
        action="ORG_DELETE"
        description={detail ? `删除组织「${detail.name}」` : ""}
        onClose={() => setDeleteStepUpOpen(false)}
        onConfirmed={onDeleteConfirmed}
      />
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}
