"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { LoadingBlock, EmptyState, ErrorBanner } from "@/components/ui/StatusBlocks";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { orgApi, type OrgTreeNode, type SysOrg } from "@/lib/api/org";
import type { ApiError } from "@/lib/api/client";

const SENSITIVE_ACTION = "ORG_DELETE";
const DING_TIP = "钉钉同步部门，请先在钉钉调整";

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
  const toast = useToast();
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
      toast.warn("请输入名称");
      return;
    }
    setCreateSubmitting(true);
    try {
      await orgApi.create({
        parentId: createParentId ?? undefined,
        name: createName.trim(),
        code: createCode.trim() || undefined,
      });
      toast.success("已创建");
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
      toast.warn("名称不能为空");
      return;
    }
    if (v === selectedNode.name) {
      setRenaming(false);
      return;
    }
    try {
      await orgApi.update(selectedNode.id, { name: v });
      toast.success("已保存");
      setRenaming(false);
      load();
    } catch {
      /* 全局 toast 已上报 */
    }
  }

  async function doDelete() {
    if (!selectedNode) return;
    if (!confirm(`删除组织「${selectedNode.name}」？需要钉钉验证码二次确认。`)) return;
    try {
      await orgApi.requestSensitiveCode(SENSITIVE_ACTION);
      const code = window.prompt(
        "钉钉收到的 6 位验证码（钉钉未配 dingtalk_userid 时看 backend 日志）："
      );
      if (!code) {
        toast.info("已取消");
        return;
      }
      const { sensitiveToken } = await orgApi.verifySensitive(SENSITIVE_ACTION, code);
      await orgApi.remove(selectedNode.id, sensitiveToken);
      toast.success("已删除");
      setSelectedId(null);
      load(false);
    } catch {
      /* 全局 toast 已上报 */
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">组织架构</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          维护公司 / 部门层级；钉钉同步部门请在钉钉源端编辑。
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
                展开全部
              </button>
              <button
                onClick={collapseAll}
                className="rounded border px-2 py-1 text-xs hover:bg-accent"
              >
                折叠全部
              </button>
            </div>
            <button
              onClick={() => openCreate(null)}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              + 新建顶级
            </button>
          </div>
          <div className="max-h-[700px] overflow-auto p-1">
            {loading && <LoadingBlock />}
            {!loading && tree.length === 0 && (
              <EmptyState title="暂无组织" hint="点击右上角新建顶级" />
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
            <EmptyState title="选中左侧节点查看详情" />
          )}
          {selectedNode && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">组织详情</h2>
                  {!renaming && (
                    <span className="text-base text-foreground">— {selectedNode.name}</span>
                  )}
                  {selectedDingSynced && <Badge variant="info">钉钉同步</Badge>}
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
                      重命名
                    </button>
                  )}
                  <button
                    onClick={() => openCreate(selectedNode.id)}
                    disabled={selectedDingSynced}
                    title={selectedDingSynced ? DING_TIP : undefined}
                    className="rounded border px-3 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    + 新建子部门
                  </button>
                  <button
                    onClick={doDelete}
                    disabled={selectedDingSynced}
                    title={selectedDingSynced ? DING_TIP : undefined}
                    className="rounded border border-red-300 bg-red-50 px-3 py-1 text-xs text-red-900 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    删除
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
                    保存
                  </button>
                  <button
                    onClick={() => setRenaming(false)}
                    className="rounded border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    取消
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
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={createOpen}
        onClose={() => (createSubmitting ? undefined : setCreateOpen(false))}
        title={createParentId === null ? "新建顶级组织" : "新建子部门"}
        footer={
          <>
            <button
              onClick={() => setCreateOpen(false)}
              disabled={createSubmitting}
              className="rounded border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={submitCreate}
              disabled={createSubmitting}
              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {createSubmitting ? "提交中…" : "确定"}
            </button>
          </>
        }
      >
        {createParentId !== null && (
          <div className="text-xs text-muted-foreground">
            父节点：#{createParentId} {findById(tree, createParentId)?.name ?? ""}
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">名称 *</label>
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">code（可选）</label>
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
            aria-label={isOpen ? "折叠" : "展开"}
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
            <span className="text-[11px] text-muted-foreground" title="钉钉同步">
              🔗
            </span>
          )}
        </button>
        {!synced && (
          <button
            onClick={() => onCreateChild(node.id)}
            className="hidden rounded px-1 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground group-hover:inline"
            title="新建子部门"
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
