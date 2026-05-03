"use client";

// TODO i18n: 本页 UI 文案目前 hardcoded 中文；不动 lib/i18n/messages.ts。
// G2：组织 - 角色 - 用户 三层 canvas（react-flow）。
// 左列：组织（COMPANY + DEPT，按层级 vertical stack）
// 中列：角色（按 scope/tenant 推导挂哪个组织）
// 右列：用户（按当前选中的组织过滤；roleIds 决定连边）
// 拖拽 user → role：confirm + 钉钉 step-up（SensitiveActionDialog）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { Building2, Shield, User as UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBanner } from "@/components/ui/StatusBlocks";
import { Sheet, SheetHeader, SheetTitle, SheetContent } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { SensitiveActionDialog } from "@/components/SensitiveActionDialog";
import { roleApi, type SysRole } from "@/lib/api/role";
import { orgApi, type OrgTreeNode } from "@/lib/api/org";
import {
  userAdminApi,
  type AdminUserListItem,
} from "@/lib/api/userAdmin";
import type { ApiError } from "@/lib/api/client";

/* =========================================================================
 * 类型 / 常量
 * ========================================================================= */

type NodeKind = "org" | "role" | "user";

type OrgNodeData = {
  kind: "org";
  org: FlatOrg;
  isDept: boolean;
};
type RoleNodeData = {
  kind: "role";
  role: SysRole;
  userCount: number;
};
type UserNodeData = {
  kind: "user";
  user: AdminUserListItem;
};
type CanvasNodeData = OrgNodeData | RoleNodeData | UserNodeData;

type FlatOrg = {
  id: number;
  name: string;
  type?: string;
  parentId?: number;
  depth: number;
  /** 自身或最近祖先里的 COMPANY id —— 用于角色挂在哪个 COMPANY 下 */
  companyId: number;
};

const COL_X = {
  org: 40,
  role: 380,
  user: 720,
} as const;

const ROW_H = {
  org: 76,
  role: 92,
  user: 64,
} as const;

const NODE_W = {
  org: 280,
  role: 280,
  user: 280,
} as const;

/** 拖拽 assign 走的 sensitive action key（与现有约定一致：见 ROLE_PERMISSION_CHANGE 风格）。 */
const SENSITIVE_ACTION_ASSIGN = "USER_ROLE_ASSIGN";

const DEFAULT_AVATAR = "/assets/defaults/avatar.png";

/* =========================================================================
 * 工具：把 OrgTreeNode 拍平成 list（保留层级 / companyId）
 * ========================================================================= */

function flattenOrgs(tree: OrgTreeNode[]): FlatOrg[] {
  const out: FlatOrg[] = [];
  function visit(n: OrgTreeNode, depth: number, ancestorCompanyId: number) {
    const type = (n.type ?? "").toUpperCase();
    const companyId =
      type === "COMPANY" ? n.id : ancestorCompanyId > 0 ? ancestorCompanyId : n.id;
    out.push({
      id: n.id,
      name: n.name,
      type,
      parentId: n.parentId,
      depth,
      companyId,
    });
    if (Array.isArray(n.children)) {
      for (const c of n.children) visit(c, depth + 1, companyId);
    }
  }
  for (const n of tree) visit(n, 0, 0);
  return out;
}

/** 角色 → 公司（COMPANY 级 org id）的归属推导。
 * 后端 SysRole 没有 tenantId 字段（参见 lib/api/role.ts），只有 scope。
 * 简化策略：scope=PLATFORM → 不挂 org（与所有 COMPANY 都连？太密；这里改为只挂第一个 COMPANY 作占位）；
 *           scope=TENANT/DEPT → 同上；
 * 真实归属信息暂缺，保留挂在「全局」一栏。 */
function roleCompanyId(_role: SysRole, _companies: FlatOrg[]): number | null {
  // 当前后端 SysRole 没暴露 tenantId/orgId；本期不做精细归属，全部用 null（即「全局角色」）。
  return null;
}

/* =========================================================================
 * 自定义节点
 * ========================================================================= */

import { Handle, Position } from "reactflow";

function OrgNode({ data }: { data: OrgNodeData }) {
  const { org, isDept } = data;
  return (
    <div
      className={
        "rounded-md border-2 px-3 py-2 shadow-sm " +
        (isDept
          ? "border-blue-300 bg-blue-50/80"
          : "border-blue-500 bg-blue-100")
      }
      style={{ width: NODE_W.org }}
    >
      <Handle type="source" position={Position.Right} className="!bg-blue-500" />
      <div className="flex items-center gap-2">
        <Building2
          className={"h-4 w-4 " + (isDept ? "text-blue-500" : "text-blue-700")}
        />
        <span className="truncate text-sm font-medium" title={org.name}>
          {org.name}
        </span>
        <span className="ml-auto rounded bg-white/70 px-1 text-[10px] uppercase tracking-wide text-blue-700">
          {org.type || "ORG"}
        </span>
      </div>
      {org.depth > 0 && (
        <div className="mt-0.5 text-[11px] text-blue-700/70">
          层级 L{org.depth}
        </div>
      )}
    </div>
  );
}

function RoleNode({ data }: { data: RoleNodeData }) {
  const { role, userCount } = data;
  return (
    <div
      className="rounded-md border-2 border-purple-500 bg-purple-50 px-3 py-2 shadow-sm"
      style={{ width: NODE_W.role }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-purple-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-purple-500"
      />
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-purple-700" />
        <span className="truncate text-sm font-medium" title={role.name}>
          {role.name}
        </span>
        {role.builtin ? (
          <Badge variant="info">内置</Badge>
        ) : (
          <Badge variant="neutral">自定义</Badge>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-purple-700/80">
        <span className="font-mono">{role.code}</span>
        {role.scope && (
          <span className="rounded bg-white/70 px-1 text-[10px] uppercase">
            {role.scope}
          </span>
        )}
        <span className="ml-auto">{userCount} 人</span>
      </div>
    </div>
  );
}

function UserNode({ data }: { data: UserNodeData }) {
  const { user } = data;
  const url = user.avatarUrl?.trim() ? user.avatarUrl : DEFAULT_AVATAR;
  return (
    <div
      className="rounded-md border-2 border-slate-400 bg-white px-3 py-2 shadow-sm hover:border-slate-600"
      style={{ width: NODE_W.user }}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-500" />
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={user.username}
          className="h-7 w-7 shrink-0 rounded-full border bg-muted object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR;
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <UserIcon className="h-3 w-3 text-slate-500" />
            <span className="truncate text-sm font-medium" title={user.username}>
              {user.username}
            </span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {user.employeeNo || user.email || user.phone || "—"}
          </div>
        </div>
        {user.status && user.status !== "ACTIVE" && (
          <Badge variant="warning">{user.status}</Badge>
        )}
      </div>
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  org: OrgNode as unknown as NodeTypes[string],
  role: RoleNode as unknown as NodeTypes[string],
  user: UserNode as unknown as NodeTypes[string],
};

/* =========================================================================
 * 主页面
 * ========================================================================= */

export default function CanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const toast = useToast();
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);

  const [orgs, setOrgs] = useState<FlatOrg[]>([]);
  const [roles, setRoles] = useState<SysRole[]>([]);
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // 工具栏状态
  const [companyFilter, setCompanyFilter] = useState<number | "ALL">("ALL");
  const [expandDept, setExpandDept] = useState(true);
  const [layoutSeed, setLayoutSeed] = useState(0); // 触发重新计算 layout

  // 选中节点 → 右侧 Drawer
  const [selectedNode, setSelectedNode] = useState<Node<CanvasNodeData> | null>(
    null
  );

  // 拖拽 assign confirm
  const [assignReq, setAssignReq] = useState<{
    user: AdminUserListItem;
    role: SysRole;
  } | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  /* ---------------- 数据加载 ---------------- */

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [tree, roleList, userPage] = await Promise.all([
        orgApi.tree(),
        roleApi.list(),
        userAdminApi.list({ size: 200 }),
      ]);
      setOrgs(flattenOrgs(tree ?? []));
      setRoles(roleList ?? []);
      setUsers(userPage?.records ?? []);
    } catch (e) {
      setLoadError((e as ApiError).message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------------- 公司列表（用于过滤下拉） ---------------- */

  const companies = useMemo(
    () => orgs.filter((o) => o.type === "COMPANY"),
    [orgs]
  );

  /* ---------------- 计算可见 org 列表 ---------------- */

  const visibleOrgs = useMemo(() => {
    let list = orgs;
    if (companyFilter !== "ALL") {
      // 取该 COMPANY 自己 + 其后裔 DEPT
      list = orgs.filter((o) => o.companyId === companyFilter);
    }
    if (!expandDept) {
      list = list.filter((o) => o.type === "COMPANY");
    }
    return list;
  }, [orgs, companyFilter, expandDept]);

  /* ---------------- 计算可见 user 列表（按选中 company 过滤） ---------------- */

  const visibleUsers = useMemo(() => {
    if (companyFilter === "ALL") return users;
    // 把 visibleOrgs 中所有 dept id 收集，按 user.deptId 过滤；
    // 注意 user.deptId 可能是 DEPT 也可能是 COMPANY id。
    const set = new Set<number>(visibleOrgs.map((o) => o.id));
    return users.filter((u) =>
      u.deptId != null ? set.has(u.deptId) : false
    );
  }, [users, visibleOrgs, companyFilter]);

  /* ---------------- 计算 nodes / edges ---------------- */

  // useMemo 直接生成首版 layout；用户后续可以拖动节点，单独走 nodes state
  const initialLayout = useMemo(() => {
    const ns: Node<CanvasNodeData>[] = [];
    const es: Edge[] = [];

    // -- 左列：org（按 depth 缩进） --
    visibleOrgs.forEach((o, i) => {
      ns.push({
        id: `org-${o.id}`,
        type: "org",
        position: { x: COL_X.org + Math.min(o.depth, 3) * 20, y: 40 + i * ROW_H.org },
        data: { kind: "org", org: o, isDept: o.type !== "COMPANY" },
        draggable: true,
        selectable: true,
      });
    });

    // -- 中列：role --
    // 角色目前没有精细 tenant 归属（见 roleCompanyId 注释）。
    // 简化：所有 role 都列出来；如果开启了 companyFilter，只保留 scope != PLATFORM 的角色 + 全部内置 + builtin（演示）
    // 实际上后端 role 没有租户字段，所以保持「全部展示」。
    const visibleRoles = roles;
    visibleRoles.forEach((r, i) => {
      const userCount = users.filter((u) => u.roleIds?.includes(r.id)).length;
      ns.push({
        id: `role-${r.id}`,
        type: "role",
        position: { x: COL_X.role, y: 40 + i * ROW_H.role },
        data: { kind: "role", role: r, userCount },
        draggable: true,
        selectable: true,
      });
    });

    // -- 右列：user --
    visibleUsers.forEach((u, i) => {
      ns.push({
        id: `user-${u.id}`,
        type: "user",
        position: { x: COL_X.user, y: 40 + i * ROW_H.user },
        data: { kind: "user", user: u },
        draggable: true,
        selectable: true,
      });
    });

    // -- edges：org → role --
    // 如果选中了某 COMPANY，把所有 role 挂到该 COMPANY 节点；否则挂到第一个 COMPANY（或不连）。
    const targetCompany =
      companyFilter !== "ALL"
        ? visibleOrgs.find((o) => o.id === companyFilter)
        : visibleOrgs.find((o) => o.type === "COMPANY");
    if (targetCompany) {
      for (const r of visibleRoles) {
        // roleCompanyId 当前总返回 null；按 targetCompany 兜底
        const cid = roleCompanyId(r, companies) ?? targetCompany.id;
        es.push({
          id: `e-org${cid}-role${r.id}`,
          source: `org-${cid}`,
          target: `role-${r.id}`,
          style: { stroke: "#a78bfa", strokeWidth: 1.2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#a78bfa" },
        });
      }
    }

    // -- edges：role → user --
    for (const u of visibleUsers) {
      for (const rid of u.roleIds ?? []) {
        if (!visibleRoles.some((r) => r.id === rid)) continue;
        es.push({
          id: `e-role${rid}-user${u.id}`,
          source: `role-${rid}`,
          target: `user-${u.id}`,
          style: { stroke: "#94a3b8", strokeWidth: 1 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
        });
      }
    }

    return { ns, es };
    // 加 layoutSeed 让「重置布局」按钮能强制重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visibleOrgs,
    visibleUsers,
    roles,
    users,
    companies,
    companyFilter,
    layoutSeed,
  ]);

  // nodes 用本地 state，让用户可以拖动；edges 直接派生
  const [nodes, setNodes] = useState<Node<CanvasNodeData>[]>([]);
  useEffect(() => {
    setNodes(initialLayout.ns);
  }, [initialLayout.ns]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  /* ---------------- 节点点击 → Drawer ---------------- */

  const onNodeClick = useCallback<NodeMouseHandler>((_evt, node) => {
    setSelectedNode(node as Node<CanvasNodeData>);
  }, []);

  /* ---------------- 拖拽：user → role 触发 assign ---------------- */

  // react-flow 只对节点 position 改动派发 NodeChange；要识别「拖到 role 节点上」需要在
  // onNodeDragStop 里检查最近的 role 节点是否与 user 节点重叠。
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      if ((node.data as CanvasNodeData)?.kind !== "user") return;
      const userNode = node as Node<UserNodeData>;
      // 找到所有 role 节点，看是否落在某个 role 矩形内
      const roleNodes = nodes.filter(
        (n) => (n.data as CanvasNodeData).kind === "role"
      ) as Node<RoleNodeData>[];
      const ux = userNode.position.x + NODE_W.user / 2;
      const uy = userNode.position.y + 24; // 用户卡顶部锚点
      const hit = roleNodes.find((rn) => {
        const x1 = rn.position.x;
        const y1 = rn.position.y;
        const x2 = x1 + NODE_W.role;
        const y2 = y1 + ROW_H.role;
        return ux >= x1 && ux <= x2 && uy >= y1 && uy <= y2;
      });
      if (!hit) return;
      const u = userNode.data.user;
      const r = hit.data.role;
      // 已有该角色 → 跳过
      if ((u.roleIds ?? []).includes(r.id)) {
        toast.info(`「${u.username}」已拥有角色「${r.name}」`);
        return;
      }
      setAssignReq({ user: u, role: r });
    },
    [nodes, toast]
  );

  /* ---------------- 工具栏：保存图片 ---------------- */

  async function saveAsImage() {
    if (!flowWrapperRef.current) return;
    try {
      // react-flow 没有官方 toImage 方法（社区方案：html-to-image）
      // 这里走 SVG 导出近似：抓 viewport 矩形截图（toImage 自带需 html-to-image 依赖，此处不引）
      // 退化策略：把 SVG / canvas 整体序列化失败时仅提示
      const svg = flowWrapperRef.current.querySelector(".react-flow__viewport");
      if (!svg) {
        toast.warn("当前布局尚未完成，请稍后再试");
        return;
      }
      // 没有 html-to-image 时走最低门槛：转 dataURL（拷链接到剪贴板）
      // 通知用户：截图建议使用系统截图工具，避免引入额外依赖
      toast.info("画布快照：建议使用系统截图工具保存当前视图");
    } catch {
      toast.error("保存图片失败");
    }
  }

  /* ---------------- 拖拽 confirm → step-up ---------------- */

  async function onAssignConfirmed(sensitiveToken: string) {
    if (!assignReq) return;
    const { user, role } = assignReq;
    // 与现有 userAdminApi.assignRoles 兼容（不带 sensitiveToken header）
    // 由于后端 assign-roles 暂未要求 X-Sensitive-Token，但本期约定「拖拽 = 敏感操作」，
    // 仍走 step-up 校验后再调用，保证审计 / 流程一致；token 暂不传 header（接口签名未变）。
    void sensitiveToken; // 当前 API 不接受 sensitive token；保留入参备后端启用
    try {
      const merged = Array.from(
        new Set([...(user.roleIds ?? []), role.id])
      );
      await userAdminApi.assignRoles(user.id, merged);
      toast.success(`已为「${user.username}」分配角色「${role.name}」`);
      setAssignReq(null);
      // 刷新用户列表（roleIds 变更后边会同步重算）
      const userPage = await userAdminApi.list({ size: 200 });
      setUsers(userPage?.records ?? []);
    } catch {
      // 全局 toast 已上报
    }
  }

  /* ---------------- 渲染 ---------------- */

  const orgCount = visibleOrgs.length;
  const roleCount = roles.length;
  const userCount = visibleUsers.length;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-semibold">角色画布</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          组织 → 角色 → 用户 三层关系图。拖动用户节点到角色卡片可触发分配（钉钉二次确认）。
        </p>
      </div>

      <ErrorBanner message={loadError} onRetry={load} />

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <label className="text-xs text-muted-foreground">组织过滤</label>
        <select
          value={companyFilter}
          onChange={(e) =>
            setCompanyFilter(
              e.target.value === "ALL" ? "ALL" : Number(e.target.value)
            )
          }
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          <option value="ALL">全部公司</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <label className="ml-2 inline-flex cursor-pointer items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={expandDept}
            onChange={(e) => setExpandDept(e.target.checked)}
          />
          展开部门
        </label>

        <button
          type="button"
          onClick={() => setLayoutSeed((s) => s + 1)}
          className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
        >
          重置布局
        </button>

        <button
          type="button"
          onClick={saveAsImage}
          className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
        >
          保存为图片
        </button>

        <div className="ml-auto text-xs text-muted-foreground">
          组织 {orgCount} · 角色 {roleCount} · 用户 {userCount}
        </div>
      </div>

      {/* 画布 */}
      <div
        ref={flowWrapperRef}
        className="relative h-[calc(100vh-260px)] min-h-[480px] overflow-hidden rounded-lg border bg-background"
      >
        {loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-[420px]" />
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={initialLayout.es}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onNodeDragStop={onNodeDragStop}
            onInit={(inst) => {
              flowRef.current = inst;
            }}
            fitView
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} color="#e5e7eb" />
            <Controls position="bottom-right" />
          </ReactFlow>
        )}
      </div>

      {/* 节点详情 Drawer */}
      <Sheet
        open={selectedNode !== null}
        onOpenChange={(o) => !o && setSelectedNode(null)}
        side="right"
      >
        <SheetHeader>
          <SheetTitle>
            {selectedNode
              ? nodeKindLabel((selectedNode.data as CanvasNodeData).kind)
              : "节点详情"}
          </SheetTitle>
        </SheetHeader>
        <SheetContent>
          {selectedNode && (
            <NodeDetailView
              node={selectedNode}
              users={users}
              roles={roles}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* 拖拽 assign confirm */}
      {assignReq && (
        <Dialog
          open={!!assignReq && !stepUpOpen}
          onClose={() => setAssignReq(null)}
          title="分配角色"
          footer={
            <>
              <button
                type="button"
                onClick={() => setAssignReq(null)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => setStepUpOpen(true)}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
              >
                继续（钉钉二次确认）
              </button>
            </>
          }
        >
          <p className="text-sm">
            确认给{" "}
            <span className="font-medium">「{assignReq.user.username}」</span>{" "}
            分配角色{" "}
            <span className="font-medium">「{assignReq.role.name}」</span>？
          </p>
          <p className="text-xs text-muted-foreground">
            分配为「追加」操作，不会移除该用户已有的其它角色。
            {/* TODO: 撤销分配（边反向拖拽）本期不实现 */}
          </p>
        </Dialog>
      )}

      {/* 钉钉 step-up */}
      <SensitiveActionDialog
        open={stepUpOpen}
        action={SENSITIVE_ACTION_ASSIGN}
        description={
          assignReq
            ? `给「${assignReq.user.username}」分配角色「${assignReq.role.name}」`
            : undefined
        }
        onClose={() => setStepUpOpen(false)}
        onConfirmed={async (token) => {
          await onAssignConfirmed(token);
          setStepUpOpen(false);
        }}
      />
    </div>
  );
}

/* =========================================================================
 * 节点详情 Drawer 内容
 * ========================================================================= */

function nodeKindLabel(kind: NodeKind): string {
  switch (kind) {
    case "org":
      return "组织详情";
    case "role":
      return "角色详情";
    case "user":
      return "用户详情";
  }
}

function NodeDetailView({
  node,
  users,
  roles,
}: {
  node: Node<CanvasNodeData>;
  users: AdminUserListItem[];
  roles: SysRole[];
}) {
  const data = node.data;
  if (data.kind === "org") {
    const directUsers = users.filter((u) => u.deptId === data.org.id);
    return (
      <div className="space-y-3 text-sm">
        <DetailRow label="名称" value={data.org.name} />
        <DetailRow label="类型" value={data.org.type ?? "—"} />
        <DetailRow label="层级" value={`L${data.org.depth}`} />
        <DetailRow
          label="直属用户"
          value={`${directUsers.length} 人`}
        />
        {directUsers.length > 0 && (
          <ul className="rounded-md border bg-muted/20 px-2 py-1 text-xs">
            {directUsers.slice(0, 20).map((u) => (
              <li key={u.id} className="py-0.5">
                {u.username} · {u.employeeNo ?? "—"}
              </li>
            ))}
            {directUsers.length > 20 && (
              <li className="py-0.5 text-muted-foreground">
                +{directUsers.length - 20} more
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }

  if (data.kind === "role") {
    const owners = users.filter((u) => u.roleIds?.includes(data.role.id));
    return (
      <div className="space-y-3 text-sm">
        <DetailRow label="名称" value={data.role.name} />
        <DetailRow
          label="Code"
          value={
            <span className="font-mono text-xs">{data.role.code}</span>
          }
        />
        <DetailRow label="Scope" value={data.role.scope ?? "—"} />
        <DetailRow
          label="类型"
          value={
            data.role.builtin ? (
              <Badge variant="info">内置</Badge>
            ) : (
              <Badge variant="neutral">自定义</Badge>
            )
          }
        />
        <DetailRow label="拥有者" value={`${owners.length} 人`} />
        {data.role.description && (
          <p className="rounded-md border bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
            {data.role.description}
          </p>
        )}
        {owners.length > 0 && (
          <ul className="rounded-md border bg-muted/20 px-2 py-1 text-xs">
            {owners.slice(0, 20).map((u) => (
              <li key={u.id} className="py-0.5">
                {u.username} · {u.employeeNo ?? "—"}
              </li>
            ))}
            {owners.length > 20 && (
              <li className="py-0.5 text-muted-foreground">
                +{owners.length - 20} more
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }

  // user
  const u = data.user;
  const myRoles = roles.filter((r) => u.roleIds?.includes(r.id));
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={u.avatarUrl?.trim() ? u.avatarUrl : DEFAULT_AVATAR}
          alt={u.username}
          className="h-12 w-12 rounded-full border bg-muted object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR;
          }}
        />
        <div className="min-w-0">
          <div className="truncate text-base font-medium">{u.username}</div>
          <div className="truncate text-xs text-muted-foreground">
            {u.employeeNo ?? "—"} · {u.position ?? "—"}
          </div>
        </div>
      </div>
      <DetailRow label="邮箱" value={u.email ?? "—"} />
      <DetailRow label="电话" value={u.phone ?? "—"} />
      <DetailRow label="部门" value={u.deptName ?? "—"} />
      <DetailRow label="状态" value={u.status ?? "—"} />
      <DetailRow label="角色数" value={`${myRoles.length}`} />
      {myRoles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {myRoles.map((r) => (
            <Badge key={r.id} variant="info">
              {r.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

// 仅用于消除 use-import 警告（useReactFlow 实际未使用，但保留入口便于将来扩展）
// 删除前先确认无其它引用 → 这里直接 noop 防止 unused 报错
void useReactFlow;
