"use client";

// G3 IAM 单页：组织树 / 角色卡 / 用户表 三栏。
// - 替代旧三件：/orgs、/admin/role、/admin/users（旧页 phase-2 删）
// - 顶级组织创建 + 钉钉同步：CreateCompanyDialog
// - 节点深度操作（重命名/删除/钉钉配置/手动同步）：OrgDetailSheet
// - 「待激活」状态：前端派生 ACTIVE && passwordMustChange && lastLoginAt 为空

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Shield,
  Users,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Network,
  Filter,
  ShieldCheck,
  ScrollText,
  UserPlus,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { LoadingBlock, ErrorBanner, EmptyState } from "@/components/ui/StatusBlocks";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";

import { orgApi, type OrgTreeNode } from "@/lib/api/org";
import { roleApi, type RoleListItem } from "@/lib/api/role";
import {
  userAdminApi,
  type AdminUserListItem,
} from "@/lib/api/userAdmin";
import type { ApiError } from "@/lib/api/client";

import { CreateCompanyDialog } from "./_components/CreateCompanyDialog";
import { OrgDetailSheet } from "./_components/OrgDetailSheet";
import { PermissionMatrixDialog } from "./_components/PermissionMatrixDialog";
import { InviteUserDialog } from "./_components/InviteUserDialog";
import { UserRowMenu } from "./_components/UserRowMenu";
import { RoleCardMenu } from "./_components/RoleCardMenu";
import { RoleEditDialog } from "./_components/RoleEditDialog";
import { AssignRolesDialog } from "./_components/AssignRolesDialog";
import type { SysRole } from "@/lib/api/role";

/* =========================================================================
 * 工具
 * ========================================================================= */

type StatusTab = "ALL" | "ACTIVE" | "PENDING" | "FROZEN";

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "ALL", label: "全部" },
  { value: "ACTIVE", label: "启用" },
  { value: "PENDING", label: "待激活" },
  { value: "FROZEN", label: "已禁用" },
];

const SCOPE_LABEL: Record<string, string> = {
  PLATFORM: "全局",
  TENANT: "租户",
  DEPT: "组织",
};

/** ACTIVE && passwordMustChange && !lastLoginAt → 待激活 */
function deriveStatus(u: AdminUserListItem): "ACTIVE" | "PENDING" | "FROZEN" | "OTHER" {
  if (u.status === "FROZEN") return "FROZEN";
  if (u.status === "ACTIVE") {
    if (u.passwordMustChange && !u.lastLoginAt) return "PENDING";
    return "ACTIVE";
  }
  return "OTHER";
}

function statusBadge(s: ReturnType<typeof deriveStatus>) {
  if (s === "ACTIVE") return <span className="inline-flex items-center gap-1.5 text-xs"><span className="size-2 rounded-full bg-green-500" />启用</span>;
  if (s === "PENDING") return <span className="inline-flex items-center gap-1.5 text-xs"><span className="size-2 rounded-full bg-amber-500" />待激活</span>;
  if (s === "FROZEN") return <span className="inline-flex items-center gap-1.5 text-xs"><span className="size-2 rounded-full bg-zinc-400" />已禁用</span>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

/** 把 OrgTreeNode 拍平 + 计算每个节点的「自己 + 子孙」id 集合，用于「选中本节点 → 显示该节点及子孙下所有用户」。
 *  同时聚合 userCount：本节点直挂员工 + 所有子孙员工总数（前端 sum 求和；
 *  注意：一个员工挂多个部门时会在子节点之间被重复计数，但同一员工不会在同一节点重复计数 —— 这是后端 SELECT COUNT(DISTINCT user_id) GROUP BY org_id 决定的）。 */
type FlatOrg = {
  id: number;
  name: string;
  parentId?: number;
  type?: string;
  depth: number;
  hasChildren: boolean;
  /** 包含自己 + 所有子孙的 id 列表 */
  descendantIds: number[];
  /** 自己 + 子孙的员工总数 */
  userCount: number;
  dingtalkDeptId?: number | string;
};

function flatten(tree: OrgTreeNode[]): {
  flat: FlatOrg[];
  descMap: Map<number, number[]>;
  userCountMap: Map<number, number>;
} {
  const flat: FlatOrg[] = [];
  const descMap = new Map<number, number[]>();
  const userCountMap = new Map<number, number>();
  function visit(n: OrgTreeNode, depth: number): { ids: number[]; users: number } {
    const entry: FlatOrg = {
      id: n.id,
      name: n.name,
      parentId: n.parentId,
      type: n.type,
      depth,
      hasChildren: !!(n.children && n.children.length > 0),
      descendantIds: [n.id],
      userCount: 0,
      dingtalkDeptId: n.dingtalkDeptId,
    };
    flat.push(entry);
    const ids = [n.id];
    let users = Number(n.userCount ?? 0);
    if (n.children) {
      for (const c of n.children) {
        const r = visit(c, depth + 1);
        ids.push(...r.ids);
        users += r.users;
      }
    }
    entry.descendantIds = ids;
    entry.userCount = users;
    descMap.set(n.id, ids);
    userCountMap.set(n.id, users);
    return { ids, users };
  }
  for (const n of tree) visit(n, 0);
  return { flat, descMap, userCountMap };
}

function relativeTime(iso?: string): string {
  if (!iso) return "从未登录";
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return Math.floor(diff / 60_000) + " 分钟前";
  if (diff < 86_400_000) return Math.floor(diff / 3600_000) + " 小时前";
  if (diff < 86_400_000 * 2) return "昨天";
  if (diff < 86_400_000 * 7) return Math.floor(diff / 86_400_000) + " 天前";
  return new Date(iso).toLocaleDateString("zh-CN");
}

/* =========================================================================
 * 主页
 * ========================================================================= */

export default function IamPage() {
  const router = useRouter();
  const toast = useToast();

  // ---- 全局数据 ----
  const [tree, setTree] = useState<OrgTreeNode[]>([]);
  const [orgsFlat, setOrgsFlat] = useState<FlatOrg[]>([]);
  const [orgDescMap, setOrgDescMap] = useState<Map<number, number[]>>(new Map());
  const [orgUserCountMap, setOrgUserCountMap] = useState<Map<number, number>>(new Map());
  const [roles, setRoles] = useState<RoleListItem[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [orgError, setOrgError] = useState("");
  const [roleError, setRoleError] = useState("");

  // ---- 用户分页 ----
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userError, setUserError] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userPageSize] = useState(20);

  // ---- 筛选 ----
  const [orgSearch, setOrgSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userSearchInput, setUserSearchInput] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("ALL");

  // ---- Dialogs / Sheets ----
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<number | null>(null);
  const [detailOrgId, setDetailOrgId] = useState<number | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixRoleId, setMatrixRoleId] = useState<number | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleEditOpen, setRoleEditOpen] = useState(false);
  const [roleEditMode, setRoleEditMode] = useState<"create" | "edit">("create");
  const [roleEditTarget, setRoleEditTarget] = useState<SysRole | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState<number | null>(null);

  /* ---- 加载 ---- */

  const loadOrgs = useCallback(async () => {
    setOrgsLoading(true);
    setOrgError("");
    try {
      const t = await orgApi.tree();
      const arr = t ?? [];
      setTree(arr);
      const { flat, descMap, userCountMap } = flatten(arr);
      setOrgsFlat(flat);
      setOrgDescMap(descMap);
      setOrgUserCountMap(userCountMap);
      // 默认所有顶级节点展开
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const n of arr) next.add(n.id);
        return next;
      });
    } catch (e) {
      setOrgError((e as ApiError).message);
    } finally {
      setOrgsLoading(false);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    setRoleError("");
    try {
      const list = await roleApi.list();
      setRoles(list ?? []);
    } catch (e) {
      setRoleError((e as ApiError).message);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUserError("");
    try {
      // 选中节点 → 取「自己 + 所有子孙」id 列表，传给后端 deptIds[]，命中任一即算。
      const descendantIds =
        selectedOrgId != null ? orgDescMap.get(selectedOrgId) : undefined;
      const r = await userAdminApi.list({
        keyword: userSearch || undefined,
        page: userPage,
        size: userPageSize,
        deptIds: descendantIds && descendantIds.length > 0 ? descendantIds : undefined,
      });
      setUsers(r.records ?? []);
      setUserTotal(r.total ?? 0);
    } catch (e) {
      setUserError((e as ApiError).message);
    } finally {
      setUsersLoading(false);
    }
  }, [userSearch, userPage, userPageSize, selectedOrgId, orgDescMap]);

  useEffect(() => {
    loadOrgs();
    loadRoles();
  }, [loadOrgs, loadRoles]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  /* ---- 派生 ---- */

  const filteredOrgs = useMemo(() => {
    if (!orgSearch.trim()) return orgsFlat;
    const q = orgSearch.trim().toLowerCase();
    return orgsFlat.filter((o) => o.name.toLowerCase().includes(q));
  }, [orgsFlat, orgSearch]);

  // 计算「可见」：父链全部 expanded
  const visibleOrgs = useMemo(() => {
    if (orgSearch.trim()) return filteredOrgs;
    const idToOrg = new Map(orgsFlat.map((o) => [o.id, o]));
    function isVisible(o: FlatOrg): boolean {
      let p = o.parentId;
      while (p) {
        if (!expanded.has(p)) return false;
        const parent = idToOrg.get(p);
        if (!parent) break;
        p = parent.parentId;
      }
      return true;
    }
    return filteredOrgs.filter(isVisible);
  }, [filteredOrgs, expanded, orgsFlat, orgSearch]);

  const filteredRoles = useMemo(() => {
    if (!roleSearch.trim()) return roles;
    const q = roleSearch.trim().toLowerCase();
    return roles.filter(
      (r) =>
        r.role.name.toLowerCase().includes(q) ||
        r.role.code.toLowerCase().includes(q)
    );
  }, [roles, roleSearch]);

  // 用户表客户端再过一道：状态 tab 用派生状态
  const filteredUsers = useMemo(() => {
    if (statusTab === "ALL") return users;
    return users.filter((u) => deriveStatus(u) === statusTab);
  }, [users, statusTab]);

  const selectedOrgName = useMemo(() => {
    if (selectedOrgId == null) return null;
    return orgsFlat.find((o) => o.id === selectedOrgId)?.name ?? null;
  }, [selectedOrgId, orgsFlat]);

  /* ---- 交互 ---- */

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setUserPage(1);
    setUserSearch(userSearchInput);
  };

  /* =========================================================================
   * 渲染
   * ========================================================================= */

  return (
    <div className="-mx-3 flex h-[calc(100vh-72px)] gap-3 px-3">
      {/* ===== 左：组织 ===== */}
      <section className="flex w-[280px] shrink-0 flex-col rounded-lg border bg-background">
        <header className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>组织</span>
            <Badge variant="neutral" className="text-[10px]">{orgsFlat.length}</Badge>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateParentId(null);
              setCreateOpen(true);
            }}
            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent"
            title="新建顶级组织"
          >
            <Plus className="size-4" />
          </button>
        </header>
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={orgSearch}
              onChange={(e) => setOrgSearch(e.target.value)}
              placeholder="搜索组织"
              className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {orgsLoading ? (
            <LoadingBlock />
          ) : orgError ? (
            <ErrorBanner message={orgError} onRetry={loadOrgs} />
          ) : visibleOrgs.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {orgSearch ? "无匹配组织" : "暂无组织"}
            </p>
          ) : (
            <ul>
              {visibleOrgs.map((o) => {
                const isSelected = o.id === selectedOrgId;
                const isOpen = expanded.has(o.id);
                // 数字 = 该节点 + 所有子孙的去重员工数（聚合自后端 userCount）
                const cnt = orgUserCountMap.get(o.id) ?? 0;
                const Icon = o.type?.toUpperCase() === "COMPANY" ? Building2 : Network;
                return (
                  <li key={o.id}>
                    <div
                      onClick={() => {
                        setSelectedOrgId(o.id);
                        setUserPage(1);
                      }}
                      className={
                        "group flex cursor-pointer items-center gap-1 px-1 py-1 text-xs hover:bg-accent " +
                        (isSelected ? "bg-accent" : "")
                      }
                      style={{ paddingLeft: 8 + o.depth * 14 }}
                    >
                      {o.hasChildren ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(o.id);
                          }}
                          className="inline-flex size-4 items-center justify-center text-muted-foreground"
                        >
                          {isOpen ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="inline-block size-4" />
                      )}
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{o.name}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground">{cnt}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailOrgId(o.id);
                        }}
                        className="invisible inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background group-hover:visible"
                        title="组织详情"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ===== 中：角色 ===== */}
      <section className="flex w-[340px] shrink-0 flex-col rounded-lg border bg-background">
        <header className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>角色</span>
            <Badge variant="neutral" className="text-[10px]">{roles.length}</Badge>
          </div>
          <button
            type="button"
            onClick={() => {
              setRoleEditMode("create");
              setRoleEditTarget(null);
              setRoleEditOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 text-xs text-white hover:bg-zinc-800"
          >
            <Plus className="size-3.5" /> 新建角色
          </button>
        </header>
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={roleSearch}
              onChange={(e) => setRoleSearch(e.target.value)}
              placeholder="搜索角色或编码"
              className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex-1 space-y-2 overflow-auto p-2">
          {rolesLoading ? (
            <LoadingBlock />
          ) : roleError ? (
            <ErrorBanner message={roleError} onRetry={loadRoles} />
          ) : filteredRoles.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">无角色</p>
          ) : (
            filteredRoles.map((r) => (
              <article
                key={r.role.id}
                className="rounded-md border bg-background p-3 hover:border-zinc-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-medium">{r.role.name}</h4>
                    {r.role.builtin && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                        系统
                      </span>
                    )}
                  </div>
                  <RoleCardMenu
                    role={r.role}
                    onEditPermissions={() => {
                      setMatrixRoleId(r.role.id);
                      setMatrixOpen(true);
                    }}
                    onEditInfo={() => {
                      setRoleEditMode("edit");
                      setRoleEditTarget(r.role);
                      setRoleEditOpen(true);
                    }}
                    onChanged={loadRoles}
                  />
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {r.role.code}
                </p>
                {r.role.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {r.role.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                    <Shield className="size-3" />
                    数据范围·{SCOPE_LABEL[r.role.scope ?? ""] ?? r.role.scope ?? "—"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px]">
                    <ShieldCheck className="size-3" /> {r.permissionCount} 权限
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px]">
                    <Users className="size-3" /> {r.userCount}
                  </span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* ===== 右：用户 ===== */}
      <section className="flex flex-1 flex-col rounded-lg border bg-background">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">用户</span>
            <Badge variant="neutral" className="text-[10px]">{userTotal}</Badge>
            {selectedOrgName && (
              <span className="ml-2 text-xs text-muted-foreground">
                当前筛选 ·{" "}
                <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5">
                  <Building2 className="size-3" /> {selectedOrgName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOrgId(null);
                    setUserPage(1);
                  }}
                  className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  清除
                </button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMatrixOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
              title="权限矩阵"
            >
              <ShieldCheck className="size-3.5" /> 权限矩阵
            </button>
            <button
              type="button"
              onClick={() => router.push("/admin/audit-log")}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
            >
              <ScrollText className="size-3.5" /> 审计
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 text-xs text-white hover:bg-zinc-800"
            >
              <UserPlus className="size-3.5" /> 邀请用户
            </button>
          </div>
        </header>

        {/* 子工具栏：搜索 / 状态 tabs */}
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <form onSubmit={handleSearch} className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={userSearchInput}
                onChange={(e) => setUserSearchInput(e.target.value)}
                placeholder="搜索姓名 / 邮箱"
                className="w-[260px] rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </form>
          <div className="flex items-center gap-1">
            {STATUS_TABS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusTab(s.value)}
                className={
                  "rounded-md px-2.5 py-1 text-xs " +
                  (statusTab === s.value
                    ? "bg-zinc-900 text-white"
                    : "hover:bg-accent")
                }
              >
                {s.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-zinc-200" />
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground"
              title="phase-2"
            >
              <Filter className="size-3.5" /> 更多筛选
            </button>
          </div>
        </div>

        {/* 表格 */}
        <div className="flex-1 overflow-auto">
          {usersLoading ? (
            <LoadingBlock />
          ) : userError ? (
            <ErrorBanner message={userError} onRetry={loadUsers} />
          ) : filteredUsers.length === 0 ? (
            <EmptyState title="暂无用户" />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">用户</th>
                  <th className="px-3 py-2 font-medium">组织</th>
                  <th className="px-3 py-2 font-medium">角色</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">最近活动</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const ds = deriveStatus(u);
                  return (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium">
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm">
                              {u.username}
                              {u.position && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  · {u.position}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {u.email ?? u.employeeNo ?? "—"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{u.deptName ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(u.roleNames ?? []).slice(0, 3).map((rn) => (
                            <span
                              key={rn}
                              className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px]"
                            >
                              {rn}
                            </span>
                          ))}
                          {(u.roleNames?.length ?? 0) === 0 && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                          {(u.roleNames?.length ?? 0) > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{(u.roleNames?.length ?? 0) - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">{statusBadge(ds)}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {relativeTime(u.lastLoginAt)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <UserRowMenu
                          user={u}
                          onChanged={loadUsers}
                          onAssignRoles={() => {
                            setAssignUserId(u.id);
                            setAssignOpen(true);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 分页 */}
        <footer className="flex items-center justify-between border-t px-4 py-2">
          <span className="text-xs text-muted-foreground">
            共 {userTotal} 条
          </span>
          <Pagination
            total={userTotal}
            page={userPage}
            size={userPageSize}
            onChange={(p) => setUserPage(p)}
          />
        </footer>
      </section>

      {/* ===== Dialogs / Sheet ===== */}
      <CreateCompanyDialog
        open={createOpen}
        parentId={createParentId}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          loadOrgs();
        }}
      />
      <OrgDetailSheet
        orgId={detailOrgId}
        onClose={() => setDetailOrgId(null)}
        onChanged={() => {
          loadOrgs();
        }}
      />
      <PermissionMatrixDialog
        open={matrixOpen}
        roleId={matrixRoleId}
        onClose={() => {
          setMatrixOpen(false);
          setMatrixRoleId(null);
        }}
        onChanged={loadRoles}
      />
      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={() => {
          setInviteOpen(false);
          loadUsers();
        }}
      />
      <RoleEditDialog
        open={roleEditOpen}
        mode={roleEditMode}
        role={roleEditTarget}
        onClose={() => setRoleEditOpen(false)}
        onSaved={() => {
          setRoleEditOpen(false);
          loadRoles();
        }}
      />
      <AssignRolesDialog
        open={assignOpen}
        userId={assignUserId}
        availableRoles={roles.map((r) => r.role)}
        orgs={orgsFlat.map((o) => ({ id: o.id, name: o.name, depth: o.depth }))}
        onClose={() => setAssignOpen(false)}
        onSaved={() => {
          setAssignOpen(false);
          loadUsers();
        }}
      />
    </div>
  );
}
