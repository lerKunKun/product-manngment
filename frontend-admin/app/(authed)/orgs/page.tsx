"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, EmptyState, ErrorBanner } from "@/components/ui/StatusBlocks";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import {
  orgApi,
  type OrgTreeNode,
  type SysOrg,
  type DingtalkConfigView,
  type DingtalkConfigInput,
} from "@/lib/api/org";
import type { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";
import { Spinner } from "@/components/ui/StatusBlocks";

const SENSITIVE_ACTION = "ORG_DELETE";

function isDingSynced(node: { dingtalkDeptId?: number | string | null }) {
  const v = node.dingtalkDeptId;
  return v !== undefined && v !== null && String(v).length > 0;
}

function collectIds(nodes: OrgTreeNode[] | undefined, acc: number[] = []): number[] {
  if (!nodes) return acc;
  for (const n of nodes) {
    acc.push(n.id);
    if (n.children?.length) collectIds(n.children, acc);
  }
  return acc;
}

function findById(nodes: OrgTreeNode[] | undefined, id: number): OrgTreeNode | null {
  if (!nodes) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findById(n.children, id);
    if (c) return c;
  }
  return null;
}

export default function OrgsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const DING_TIP = t("orgs.dingTip");
  const [tree, setTree] = useState<OrgTreeNode[]>([]);
  const [list, setList] = useState<SysOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createParentId, setCreateParentId] = useState<number | null>(null);

  // F1：钉钉配置 + F3：立即同步
  const [dingCfg, setDingCfg] = useState<DingtalkConfigView | null>(null);
  const [dingCfgLoading, setDingCfgLoading] = useState(false);
  const [dingCfgForm, setDingCfgForm] = useState<DingtalkConfigInput>({
    corpId: "",
    appKey: "",
    appSecret: "",
    agentId: "",
    eventToken: "",
    eventAesKey: "",
  });
  const [dingCfgSaving, setDingCfgSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load(keepSelected = true) {
    setLoading(true);
    setError("");
    try {
      const [t, l] = await Promise.all([orgApi.tree(), orgApi.list()]);
      const tArr = t ?? [];
      setTree(tArr);
      setList(l ?? []);
      // 默认顶级展开
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const n of tArr) next.add(n.id);
        return next;
      });
      if (!keepSelected) setSelectedId(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedNode = useMemo(() => findById(tree, selectedId ?? -1), [tree, selectedId]);
  const selectedDetail: SysOrg | undefined = useMemo(
    () => list.find((o) => o.id === selectedId),
    [list, selectedId]
  );
  const selectedDingSynced = selectedNode
    ? isDingSynced(selectedNode) || isDingSynced(selectedDetail ?? {})
    : false;
  const selectedIsCompany =
    (selectedDetail?.type ?? selectedNode?.type ?? "").toUpperCase() === "COMPANY";

  // 切换选中 COMPANY 节点 → 拉钉钉配置
  useEffect(() => {
    if (!selectedId || !selectedIsCompany) {
      setDingCfg(null);
      setDingCfgForm({
        corpId: "",
        appKey: "",
        appSecret: "",
        agentId: "",
        eventToken: "",
        eventAesKey: "",
      });
      return;
    }
    setDingCfgLoading(true);
    orgApi
      .getDingtalkConfig(selectedId)
      .then((c) => {
        setDingCfg(c);
        setDingCfgForm({
          corpId: c?.corpId ?? "",
          appKey: c?.appKey ?? "",
          appSecret: "", // 永远不回填明文
          agentId: c?.agentId ?? "",
          eventToken: c?.eventToken ?? "",
          eventAesKey: c?.eventAesKey ?? "",
        });
      })
      .catch(() => {
        /* 全局 toast */
      })
      .finally(() => setDingCfgLoading(false));
  }, [selectedId, selectedIsCompany]);

  async function saveDingtalkConfig() {
    if (!selectedId) return;
    if (!dingCfgForm.corpId.trim() || !dingCfgForm.appKey.trim() || !dingCfgForm.agentId.trim()) {
      toast.warn(t("org.dingtalk.requiredHint"));
      return;
    }
    if (!dingCfg?.configured && !dingCfgForm.appSecret?.trim()) {
      toast.warn(t("org.dingtalk.secretRequiredFirst"));
      return;
    }
    setDingCfgSaving(true);
    try {
      // 不传 appSecret 时表示不更新；传了空串去掉
      const payload: DingtalkConfigInput = {
        corpId: dingCfgForm.corpId.trim(),
        appKey: dingCfgForm.appKey.trim(),
        agentId: dingCfgForm.agentId.trim(),
        eventToken: dingCfgForm.eventToken?.trim() || undefined,
        eventAesKey: dingCfgForm.eventAesKey?.trim() || undefined,
      };
      if (dingCfgForm.appSecret && dingCfgForm.appSecret.trim()) {
        payload.appSecret = dingCfgForm.appSecret.trim();
      }
      await orgApi.saveDingtalkConfig(selectedId, payload);
      toast.success(t("org.dingtalk.saved"));
      // 刷新（清空 secret 输入）
      const refreshed = await orgApi.getDingtalkConfig(selectedId);
      setDingCfg(refreshed);
      setDingCfgForm((p) => ({ ...p, appSecret: "" }));
    } catch {
      /* 全局 toast */
    } finally {
      setDingCfgSaving(false);
    }
  }

  async function triggerSync() {
    if (!selectedId) return;
    setSyncing(true);
    try {
      const r = await orgApi.triggerSync(selectedId);
      toast.success(
        t("org.dingtalk.syncResult")
          .replace("{added}", String(r.added))
          .replace("{skipped}", String(r.skipped))
          .replace("{failed}", String(r.failed))
      );
      load(); // 同步后刷新组织树
    } catch {
      /* 全局 toast */
    } finally {
      setSyncing(false);
    }
  }

  function expandAll() {
    setExpanded(new Set(collectIds(tree)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }
  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate(parentId: number | null) {
    setCreateParentId(parentId);
    setCreateName("");
    setCreateCode("");
    setCreateOpen(true);
  }

  async function submitCreate() {
    if (!createName.trim()) {
      toast.warn(t("orgs.nameRequired"));
      return;
    }
    setCreateSubmitting(true);
    try {
      await orgApi.create({
        parentId: createParentId ?? undefined,
        name: createName.trim(),
        code: createCode.trim() || undefined,
      });
      toast.success(t("orgs.created"));
      setCreateOpen(false);
      load();
    } catch {
      /* 全局 toast 已上报 */
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function submitRename() {
    if (!selectedNode) return;
    const v = renameValue.trim();
    if (!v) {
      toast.warn(t("orgs.nameEmpty"));
      return;
    }
    if (v === selectedNode.name) {
      setRenaming(false);
      return;
    }
    try {
      await orgApi.update(selectedNode.id, { name: v });
      toast.success(t("orgs.saved"));
      setRenaming(false);
      load();
    } catch {
      /* 全局 toast 已上报 */
    }
  }

  async function doDelete() {
    if (!selectedNode) return;
    if (!confirm(t("orgs.confirmDelete").replace("{name}", selectedNode.name))) return;
    try {
      await orgApi.requestSensitiveCode(SENSITIVE_ACTION);
      const code = window.prompt(t("orgs.dingCodePrompt"));
      if (!code) {
        toast.info(t("orgs.cancelled"));
        return;
      }
      const { sensitiveToken } = await orgApi.verifySensitive(SENSITIVE_ACTION, code);
      await orgApi.remove(selectedNode.id, sensitiveToken);
      toast.success(t("orgs.deleted"));
      setSelectedId(null);
      load(false);
    } catch {
      /* 全局 toast 已上报 */
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("orgs.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orgs.description")}
        </p>
      </div>

      <ErrorBanner message={error} onRetry={() => load(false)} />

      <div className="flex min-h-[600px] gap-4">
        {/* 左侧 树 */}
        <aside className="w-[280px] shrink-0 rounded-lg border bg-background">
          <div className="flex items-center justify-between gap-1 border-b px-2 py-2">
            <div className="flex gap-1">
              <button
                onClick={expandAll}
                className="rounded border px-2 py-1 text-xs hover:bg-accent"
              >
                {t("orgs.expandAll")}
              </button>
              <button
                onClick={collapseAll}
                className="rounded border px-2 py-1 text-xs hover:bg-accent"
              >
                {t("orgs.collapseAll")}
              </button>
            </div>
            <button
              onClick={() => openCreate(null)}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              {t("orgs.createTopLevel")}
            </button>
          </div>
          <div className="max-h-[700px] overflow-auto p-1">
            {loading && <LoadingBlock />}
            {!loading && tree.length === 0 && (
              <EmptyState title={t("orgs.empty")} hint={t("orgs.emptyHint")} />
            )}
            {!loading && tree.length > 0 && (
              <ul className="space-y-0.5">
                {tree.map((n) => (
                  <TreeNode
                    key={n.id}
                    node={n}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggle}
                    selectedId={selectedId}
                    onSelect={(id) => {
                      setSelectedId(id);
                      setRenaming(false);
                    }}
                    onCreateChild={openCreate}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* 右侧 详情 */}
        <section className="min-w-0 flex-1 rounded-lg border bg-background p-4">
          {!selectedNode && (
            <EmptyState title={t("orgs.selectNodeHint")} />
          )}
          {selectedNode && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{t("orgs.detail")}</h2>
                  {!renaming && (
                    <span className="text-base text-foreground">— {selectedNode.name}</span>
                  )}
                  {selectedDingSynced && <Badge variant="info">{t("orgs.dingSynced")}</Badge>}
                </div>
                <div className="flex gap-2">
                  {!renaming && (
                    <button
                      onClick={() => {
                        setRenameValue(selectedNode.name);
                        setRenaming(true);
                      }}
                      disabled={selectedDingSynced}
                      title={selectedDingSynced ? DING_TIP : undefined}
                      className="rounded border px-3 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("orgs.rename")}
                    </button>
                  )}
                  <button
                    onClick={() => openCreate(selectedNode.id)}
                    disabled={selectedDingSynced}
                    title={selectedDingSynced ? DING_TIP : undefined}
                    className="rounded border px-3 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("orgs.createChild")}
                  </button>
                  <button
                    onClick={doDelete}
                    disabled={selectedDingSynced}
                    title={selectedDingSynced ? DING_TIP : undefined}
                    className="rounded border border-red-300 bg-red-50 px-3 py-1 text-xs text-red-900 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </div>

              {renaming && (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="w-72 rounded-md border bg-background px-2 py-1.5 text-sm"
                  />
                  <button
                    onClick={submitRename}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    {t("common.save")}
                  </button>
                  <button
                    onClick={() => setRenaming(false)}
                    className="rounded border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <Field label="id" value={String(selectedNode.id)} mono />
                <Field label="name" value={selectedNode.name} />
                <Field
                  label="parentId"
                  value={
                    selectedDetail?.parentId !== undefined && selectedDetail?.parentId !== null
                      ? String(selectedDetail.parentId)
                      : selectedNode.parentId !== undefined && selectedNode.parentId !== null
                      ? String(selectedNode.parentId)
                      : "—"
                  }
                  mono
                />
                <Field
                  label="type"
                  value={selectedDetail?.type ?? selectedNode.type ?? "—"}
                />
                <Field
                  label="dingtalkDeptId"
                  value={
                    isDingSynced(selectedDetail ?? {}) || isDingSynced(selectedNode)
                      ? String(selectedDetail?.dingtalkDeptId ?? selectedNode.dingtalkDeptId)
                      : "—"
                  }
                  mono
                />
                <Field label="status" value={selectedDetail?.status ?? "—"} />
              </div>

              {/* F1 + F3：仅 COMPANY 节点可见 */}
              {selectedIsCompany && (
                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t("org.dingtalk.title")}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {dingCfg?.configured
                          ? t("org.dingtalk.statusConfigured")
                          : t("org.dingtalk.statusUnconfigured")}
                      </span>
                      <button
                        onClick={triggerSync}
                        disabled={syncing || !dingCfg?.configured}
                        className="inline-flex items-center gap-1 rounded border px-3 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        title={!dingCfg?.configured ? t("org.dingtalk.syncDisabledHint") : undefined}
                      >
                        {syncing && <Spinner />}
                        {t("org.dingtalk.syncNow")}
                      </button>
                    </div>
                  </div>
                  {dingCfgLoading ? (
                    <div className="text-xs text-muted-foreground">{t("common.loading")}</div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <CfgInput
                        label={t("org.dingtalk.corpId")}
                        value={dingCfgForm.corpId}
                        onChange={(v) => setDingCfgForm((p) => ({ ...p, corpId: v }))}
                      />
                      <CfgInput
                        label={t("org.dingtalk.agentId")}
                        value={dingCfgForm.agentId}
                        onChange={(v) => setDingCfgForm((p) => ({ ...p, agentId: v }))}
                      />
                      <CfgInput
                        label={t("org.dingtalk.appKey")}
                        value={dingCfgForm.appKey}
                        onChange={(v) => setDingCfgForm((p) => ({ ...p, appKey: v }))}
                      />
                      <CfgInput
                        label={t("org.dingtalk.appSecret")}
                        value={dingCfgForm.appSecret ?? ""}
                        onChange={(v) => setDingCfgForm((p) => ({ ...p, appSecret: v }))}
                        placeholder={
                          dingCfg?.configured
                            ? t("org.dingtalk.secretKeepEmpty")
                            : t("org.dingtalk.secretFirstTime")
                        }
                        type="password"
                      />
                      <CfgInput
                        label={t("org.dingtalk.eventToken")}
                        value={dingCfgForm.eventToken ?? ""}
                        onChange={(v) => setDingCfgForm((p) => ({ ...p, eventToken: v }))}
                        placeholder={t("org.dingtalk.optional")}
                      />
                      <CfgInput
                        label={t("org.dingtalk.eventAesKey")}
                        value={dingCfgForm.eventAesKey ?? ""}
                        onChange={(v) => setDingCfgForm((p) => ({ ...p, eventAesKey: v }))}
                        placeholder={t("org.dingtalk.optional")}
                      />
                    </div>
                  )}
                  <div>
                    <button
                      onClick={saveDingtalkConfig}
                      disabled={dingCfgSaving}
                      className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {dingCfgSaving && <Spinner />}
                      {t("org.dingtalk.saveConfig")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={createOpen}
        onClose={() => (createSubmitting ? undefined : setCreateOpen(false))}
        title={createParentId === null ? t("orgs.dialog.createTop") : t("orgs.dialog.createChild")}
        footer={
          <>
            <button
              onClick={() => setCreateOpen(false)}
              disabled={createSubmitting}
              className="rounded border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={submitCreate}
              disabled={createSubmitting}
              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {createSubmitting ? t("orgs.dialog.submitting") : t("orgs.dialog.confirm")}
            </button>
          </>
        }
      >
        {createParentId !== null && (
          <div className="text-xs text-muted-foreground">
            {t("orgs.dialog.parent")
              .replace("{id}", String(createParentId))
              .replace("{name}", findById(tree, createParentId)?.name ?? "")}
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("orgs.dialog.name")}</label>
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("orgs.dialog.code")}</label>
          <input
            value={createCode}
            onChange={(e) => setCreateCode(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-0.5 break-all text-sm " + (mono ? "font-mono" : "")}>
        {value}
      </div>
    </div>
  );
}

function CfgInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  onCreateChild,
}: {
  node: OrgTreeNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreateChild: (parentId: number) => void;
}) {
  const { t } = useI18n();
  const hasChildren = !!node.children?.length;
  const isOpen = expanded.has(node.id);
  const isSel = selectedId === node.id;
  const synced = isDingSynced(node);
  return (
    <li>
      <div
        className={
          "group flex items-center gap-1 rounded px-1 py-1 text-sm hover:bg-accent " +
          (isSel ? "bg-primary/10" : "")
        }
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.id)}
            className="inline-flex h-4 w-4 items-center justify-center text-xs text-muted-foreground hover:text-foreground"
            aria-label={isOpen ? t("orgs.tree.collapseChildren") : t("orgs.tree.expandChildren")}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        ) : (
          <span className="inline-block h-4 w-4" />
        )}
        <button
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1 truncate text-left"
          title={node.name}
        >
          <span className="truncate">{node.name}</span>
          {synced && (
            <span className="text-[11px] text-muted-foreground" title={t("orgs.tree.dingSyncTooltip")}>
              🔗
            </span>
          )}
        </button>
        {!synced && (
          <button
            onClick={() => onCreateChild(node.id)}
            className="hidden rounded px-1 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground group-hover:inline"
            title={t("orgs.tree.createChildLabel")}
            aria-label={t("orgs.tree.createChildLabel")}
          >
            +
          </button>
        )}
      </div>
      {hasChildren && isOpen && (
        <ul className="space-y-0.5">
          {node.children!.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
