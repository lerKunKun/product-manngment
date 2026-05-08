"use client";

// 新建组织（顶级 = COMPANY，子级 = DEPT）。
// 顶级路径：基础信息 + 折叠的钉钉配置 + 「保存并立即同步」勾选；提交链 POST /org → PUT dingtalk-config → POST sync。
// 子级路径：仅基础信息（钉钉块隐藏）。

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import {
  orgApi,
  type DingtalkConfigInput,
} from "@/lib/api/org";
import type { ApiError } from "@/lib/api/client";

const inp =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function CreateCompanyDialog({
  open,
  parentId,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** null = 创建顶级 COMPANY；数字 = 在该父节点下创建 DEPT */
  parentId: number | null;
  onClose: () => void;
  onCreated: (newId: number) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 钉钉配置（仅顶级）
  const [showDing, setShowDing] = useState(false);
  const [ding, setDing] = useState<DingtalkConfigInput>({
    corpId: "",
    appKey: "",
    appSecret: "",
    agentId: "",
    eventToken: "",
    eventAesKey: "",
  });
  const [syncAfter, setSyncAfter] = useState(true);

  const isTopLevel = parentId == null;

  useEffect(() => {
    if (!open) return;
    setName("");
    setCode("");
    setError("");
    setShowDing(false);
    setDing({ corpId: "", appKey: "", appSecret: "", agentId: "", eventToken: "", eventAesKey: "" });
    setSyncAfter(true);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("组织名必填");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // 1. 创建组织（顶级=COMPANY；子级 type 跟随父节点：COMPANY 下的子是 DEPT）
      const created = await orgApi.create({
        name: name.trim(),
        code: code.trim() || undefined,
        parentId: parentId ?? undefined,
        type: isTopLevel ? "COMPANY" : "DEPT",
      });
      const newId = created.id;

      // 2. 顶级 + 钉钉块展开 + 配置非空 → 写钉钉配置
      let savedDing = false;
      if (isTopLevel && showDing && ding.corpId && ding.appKey && ding.appSecret && ding.agentId) {
        try {
          await orgApi.saveDingtalkConfig(newId, ding);
          savedDing = true;
        } catch (e) {
          toast.warn("组织已创建，钉钉配置保存失败：" + (e as ApiError).message);
        }
      }

      // 3. 顶级 + 已配置 + 勾选立即同步 → 触发同步（异步，不阻塞）
      if (isTopLevel && savedDing && syncAfter) {
        toast.info("已触发钉钉同步，结果稍后从组织详情查看");
        // 后台触发，不 await（同步可能要 30s+）
        orgApi.triggerSync(newId).then(
          (r) => {
            toast.success(
              `钉钉同步完成：新增 ${r.added} / 跳过 ${r.skipped} / 失败 ${r.failed}`
            );
          },
          (e) => {
            toast.error("钉钉同步失败：" + (e as ApiError).message);
          }
        );
      }

      toast.success(isTopLevel ? "顶级组织已创建" : "子组织已创建");
      onCreated(newId);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isTopLevel ? "新建顶级组织" : "新建子组织"}
      className="max-w-lg"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="组织名" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inp}
            placeholder={isTopLevel ? "例：Biou 集团" : "例：上海办事处"}
            autoFocus
          />
        </Field>
        <Field label="编码（可选）">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inp}
            placeholder="例：BIOU"
          />
        </Field>

        {isTopLevel && (
          <details
            open={showDing}
            onToggle={(e) => setShowDing((e.currentTarget as HTMLDetailsElement).open)}
            className="rounded-md border"
          >
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
              钉钉配置（可选）
            </summary>
            <div className="space-y-3 border-t p-3">
              <p className="text-xs text-muted-foreground">
                填完后保存可直接拉取部门 + 员工。所有字段都从钉钉开放平台 → 应用详情拷贝。
              </p>
              <Field label="corpId" required={showDing}>
                <input
                  value={ding.corpId}
                  onChange={(e) => setDing({ ...ding, corpId: e.target.value })}
                  className={inp}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="appKey" required={showDing}>
                  <input
                    value={ding.appKey}
                    onChange={(e) => setDing({ ...ding, appKey: e.target.value })}
                    className={inp}
                  />
                </Field>
                <Field label="agentId" required={showDing}>
                  <input
                    value={ding.agentId}
                    onChange={(e) => setDing({ ...ding, agentId: e.target.value })}
                    className={inp}
                  />
                </Field>
              </div>
              <Field label="appSecret" required={showDing}>
                <input
                  type="password"
                  value={ding.appSecret ?? ""}
                  onChange={(e) => setDing({ ...ding, appSecret: e.target.value })}
                  className={inp}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="eventToken（可选）">
                  <input
                    value={ding.eventToken ?? ""}
                    onChange={(e) => setDing({ ...ding, eventToken: e.target.value })}
                    className={inp}
                  />
                </Field>
                <Field label="eventAesKey（可选）">
                  <input
                    value={ding.eventAesKey ?? ""}
                    onChange={(e) => setDing({ ...ding, eventAesKey: e.target.value })}
                    className={inp}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={syncAfter}
                  onChange={(e) => setSyncAfter(e.target.checked)}
                />
                <span>保存后立即同步钉钉部门 + 员工</span>
              </label>
            </div>
          </details>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "创建中..." : "创建"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}
