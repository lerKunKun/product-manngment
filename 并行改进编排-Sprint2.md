# 并行改进编排（Sprint 2）

> 编排：2026-05-03（Sprint 1 收尾后立即启动）
> 用途：把《前端改进文档》Sprint 2 + Sprint 3 部分项 + 余留 fix 合并切成 4 个 track。
> 文件冲突边界：T8 owns `AppShell.tsx`（NAV 加 2 个菜单项）；其它 track 不动。

---

## 0. Track 划分

| Track | 内容 | 工时 | 主要文件 |
|---|---|---|---|
| **T6** | 前端 /orgs 组织树管理 | ~2 PD | `app/(authed)/orgs/page.tsx` + `lib/api/org.ts` |
| **T7** | 前端 /admin/role 角色矩阵 + Purchase 字段对齐 fix | ~3 PD | `app/(authed)/admin/role/page.tsx` + `lib/api/role.ts` + `lib/api/purchase.ts` 修字段 |
| **T8** | dashboard 折线图 + Breadcrumb 全集成 + AppShell NAV 加 2 菜单 | ~2 PD | `app/(authed)/dashboard/page.tsx` + 7 个 [id] 详情页 + `AppShell.tsx`(owner) |
| **T9** | /tasks 增强 + /newstore saga stepper + /stores 增强 | ~3 PD | `app/(authed)/tasks/` + `newstore/[taskId]/page.tsx` + `stores/page.tsx` |

**总工时**：~10 PD（4 人并行约 1 周；本次 + agent 约 1 小时）

---

## 1. 共享文件 / 依赖

| 文件 | Owner | 其他 track 怎么办 |
|---|---|---|
| `frontend-admin/components/layout/AppShell.tsx` | **T8** | T6 / T7 不动；T8 在 prompt 中明确 NAV 系统组加 `[/orgs, "组织管理"]` 和 `[/admin/role, "角色管理"]` |
| 后端 `OrgController` | 已就绪（5 端点） | T6 直接消费；如需「子部门」「员工数」可前端自算，不补后端 |
| 后端 `SysRoleController`（T2 已交付） | 已就绪（5 端点） | T7 直接消费 |
| 后端 `PurchaseController` 字段：`grossWeight/weightUnit/logisticsTags/note/changedBy/confirmedAt/syncStatus` | 已就绪 | T7 修前端 type & UI 字段名以对齐 |
| 后端 `TaskController` SSE / retry endpoint | 待 verify | T9 先 grep 现有；缺则降级用轮询 |
| 后端 saga 步骤元数据 | `task` 表已有 `saga_step` 字段 | T9 用 task list 推导步骤进度 |

---

## 2. T6 详细任务（前端 /orgs 组织树）

### 2.1 API client
**文件**：`frontend-admin/lib/api/org.ts`
```ts
import { api } from "./client";

export type SysOrg = {
  id: number;
  parentId?: number;
  name: string;
  code?: string;
  type?: string; // COMPANY / DEPT
  dingtalkDeptId?: number;
  status?: string;
  createdAt?: string;
};

export type OrgTreeNode = {
  id: number;
  name: string;
  parentId?: number;
  type?: string;
  dingtalkDeptId?: number;
  children?: OrgTreeNode[];
  // 后端 tree 返回的是 List<Map> — 字段以实际 key 为准
};

export const orgApi = {
  tree: () => api.get<OrgTreeNode[]>(`/org/tree`),
  list: () => api.get<SysOrg[]>(`/org`),
  create: (input: Partial<SysOrg>) => api.post<{ id: number }>(`/org`, input),
  update: (id: number, patch: Partial<SysOrg>) => api.put<void>(`/org/${id}`, patch),
  remove: (id: number, sensitiveToken?: string) =>
    api.del<void>(`/org/${id}`,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken }} : undefined),
  // 复用敏感操作端点
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),
};
```

### 2.2 页面
**文件**：`frontend-admin/app/(authed)/orgs/page.tsx`

UI:
- **左侧** 30% 宽：树形组件
  - 不依赖外部库；自实现递归渲染（ul > li > 折叠箭头 + 名称 + dingtalk icon 🔗）
  - 选中节点高亮
  - 拖拽可不做（v1 不需要）
- **右侧** 70% 宽：选中节点详情
  - 字段：id / 名称 / parent / type / dingtalk_dept_id / status / created_at
  - 「重命名」按钮 → inline 编辑 → save → orgApi.update
  - 「新建子部门」按钮 → 弹 dialog 输入 name/code → orgApi.create
  - 「删除」按钮 → 钉钉 6 位码二次确认（action="ORG_DELETE"）→ orgApi.remove
  - 已绑定钉钉的部门（dingtalkDeptId 非空）：标 🔗 + 删除/重命名按钮 disable + tooltip「钉钉同步部门，请先在钉钉调整」
- 顶部「展开全部 / 折叠全部」按钮

**用 Sprint 1 已加的 ui 组件**：`Skeleton` `Badge`（dingtalk 标）；`DropdownMenu` 行操作可选

参考：`/Users/zhangxueqian/development/product-manngment/frontend-admin/app/(authed)/cross-auth/page.tsx`（列表 + 敏感操作模板）

---

## 3. T7 详细任务（角色矩阵 + Purchase 字段对齐）

### 3.1 角色管理 UI

**API client**：`frontend-admin/lib/api/role.ts`
```ts
import { api } from "./client";

export type SysRole = {
  id: number;
  code: string;
  name: string;
  description?: string;
  builtin: boolean;
  createdAt?: string;
};

export type RoleDetail = {
  role: SysRole;
  permissionCodes: string[];
  userCount: number;
};

export const roleApi = {
  list: () => api.get<SysRole[]>(`/admin/role`),
  get: (id: number) => api.get<RoleDetail>(`/admin/role/${id}`),
  create: (body: { code: string; name: string; description?: string }) =>
    api.post<number>(`/admin/role`, body),
  updatePermissions: (id: number, permissionCodes: string[], sensitiveToken?: string) =>
    api.put<void>(`/admin/role/${id}/permissions`, { permissionCodes },
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken }} : undefined),
  users: (id: number) => api.get<number[]>(`/admin/role/${id}/users`),
  // 敏感操作端点
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),
};
```

**页面**：`frontend-admin/app/(authed)/admin/role/page.tsx`
- **左侧** 30%：角色列表（builtin 标 Badge "内置"，自定义无标）+ 顶部「新建角色」按钮
- **右侧** 70%：选中角色详情
  - 顶部 cards：role.name + code + description + 内置/自定义 + 用户数
  - 「权限矩阵」section：列出全部 23 个 permission code（按 module 前缀分组：USER / STORE / PRODUCT / ASSET / SAGA / OPS 等）
    - 每个 permission 是 checkbox，已勾选 = 在 role 的 permissionCodes 中
    - 内置角色 checkbox 全部 disabled + tooltip「内置角色不可改权限」
    - 自定义角色 checkbox 可改，底部「保存」按钮 → 钉钉 6 位码（action="ROLE_PERMISSION_CHANGE"）→ updatePermissions
  - 「绑定的用户」section：拉 roleApi.users(id) 显示 userId 列表（badge 形式）

权限点 hardcode 一份字典（基于 V2__init_rbac_seed.sql 中的 23 个 permission code，按 module 分组）；
如果 23 个 code 不知道，前端先用 `Array.from(new Set(allRoles.flatMap(r=>r.permissionCodes)))` 动态聚合。

### 3.2 Purchase 字段对齐 fix

**修改**：`frontend-admin/lib/api/purchase.ts`
- `PurchaseInfo` 改字段：
  ```ts
  export type PurchaseInfo = {
    variantId: number;
    position?: number;
    sku?: string;
    option1?: string;
    option2?: string;
    price?: number;
    purchaseUrl?: string;
    cost?: number;
    currency?: string;        // CNY / USD ...
    grossWeight?: number;
    weightUnit?: string;      // g / kg
    logisticsTags?: string;   // CSV: "液体,带电"
    note?: string;
  };
  ```
- `SkuChangeLog` 改字段：
  ```ts
  export type SkuChangeLog = {
    id: number;
    variantId: number;
    productId?: number;
    oldSku: string;
    newSku: string;
    changedBy: number;
    confirmedAt: string;
    syncStatus: "PENDING" | "SUCCESS" | "PARTIAL" | "FAILED";
  };
  ```
- `changeSku` sensitive action 改 `"CHANGE_SKU"` → `"PURCHASE_SKU_EDIT"`（与后端 @RequireSensitiveOp 对齐）

**修改**：`frontend-admin/components/product/PurchaseTab.tsx` 和 `SkuChangeDialog.tsx`
- 列名对应改：克重 → 「克重 (g)」+ 输入 `grossWeight` 数字 + `weightUnit` 默认 g（不暴露 select 简化）
- 物流标签改成「逗号分隔多 tag」placeholder
- SkuChangeDialog 调用 `requestSensitiveCode("PURCHASE_SKU_EDIT")`
- skuLog timeline 字段改 `confirmedAt` / `changedBy` / 显示 `syncStatus` badge（PENDING amber / SUCCESS emerald / PARTIAL warning / FAILED rose）

参考：T2 SysRoleController 实际字段；后端 `purchase/PurchaseController.java`

---

## 4. T8 详细任务（dashboard 折线 + Breadcrumb + NAV 加菜单）

### 4.1 dashboard 24h 折线图

**修改**：`frontend-admin/app/(authed)/dashboard/page.tsx`

底部加新 section「24 小时通知发送」：
- 拉 `notificationLogApi.list({ from: 24h前ISO, size: 1000 })` 一次
- 前端聚合：按小时（0-23）+ channel（DINGTALK/EMAIL/INAPP）groupBy → 24x3 二维矩阵
- 渲染：**手写 SVG 折线图**（不引入 recharts 等库以减依赖）
  - x 轴：24 小时刻度
  - y 轴：自动 scale 0 → max
  - 3 条折线：DINGTALK 蓝 / EMAIL 绿 / INAPP 紫
  - 顶部 legend
  - 高度 200px，宽度自适应

如 `notificationLogApi` import 后端不返 1000 条，给个 placeholder「数据需 backend 补 stats/by-hour endpoint」（不 break 页面）

### 4.2 Breadcrumb 全集成

**Breadcrumb 组件**已在 Sprint 1 T3 创建：`components/ui/Breadcrumb.tsx`

在以下 7 个详情页 / 子页 顶部加 `<Breadcrumb items={...} />`，**替换**或保留现有「← 返回 X」链接（建议替换以统一风格）：

| 页面 | items |
|---|---|
| `app/(authed)/products/[id]/page.tsx` | `[{href:"/products",label:"产品库"}, {label:`#${id}`}]` |
| `app/(authed)/snapshots/[id]/page.tsx` | `[{href:"/snapshots",label:"产品快照"}, {label:`#${id}`}]` |
| `app/(authed)/approvals/[id]/page.tsx` | `[{href:"/approvals",label:"审批中心"}, {label:`#${id}`}]` |
| `app/(authed)/tasks/[id]/page.tsx` | `[{href:"/tasks",label:"任务监控"}, {label:`#${id}`}]` |
| `app/(authed)/newstore/[taskId]/page.tsx` | `[{href:"/newstore",label:"一键开店"}, {label:`Saga ${taskId}`}]` |
| `app/(authed)/guides/[id]/page.tsx` | `[{href:"/guides",label:"指导文档"}, {label:`#${id}`}]` |
| `app/(authed)/templates/[id]/page.tsx` | `[{href:"/templates",label:"模板库"}, {label:`#${id}`}]` |
| `app/(authed)/assets/[id]/page.tsx` | `[{href:"/assets",label:"资产快照"}, {label:`#${id}`}]` |

**先 Read 每个文件**，找到顶部 `<h1>` 之前 / `← 返回` 链接的位置，加上 `<Breadcrumb>`。**保留** `← 返回` 也行（双导航不冲突）；建议替换以更现代。

### 4.3 AppShell NAV 加 2 菜单

**修改**：`frontend-admin/components/layout/AppShell.tsx`

在 NAV_GROUPS 的「系统」组顶部加：
```ts
{ href: "/orgs", label: "组织管理" },
{ href: "/admin/role", label: "角色管理" },
```

最终「系统」组顺序：组织管理 / 角色管理 / 通知日志 / 审计日志。

---

## 5. T9 详细任务（/tasks 增强 + saga stepper + /stores 增强）

### 5.1 /tasks 增强

**修改**：`frontend-admin/app/(authed)/tasks/page.tsx`

新增：
- 列表行「重试」按钮（仅 status=FAILED 时启用）
  - 调 `taskApi.retry(id)`（如不存在用 `POST /tasks/{id}/retry`，前端先实现 client，**如后端无此端点**输出报告里说明）
- 列表行「展开」按钮（如有 `parent_task_id`）→ inline 显示子任务（同表格内嵌）
  - 子任务列表用相同表格样式 + 缩进
- 顶部加「自动刷新 30s」开关（默认开）
  - state `autoRefresh` + setInterval 调 `taskApi.list` refresh

### 5.2 /tasks/[id] 增强

**修改**：`frontend-admin/app/(authed)/tasks/[id]/page.tsx`

- 顶部 status badge 用 Sprint 1 的 `<Badge>` 组件
- 加「重试」按钮（FAILED 时）
- payload + result JSON pretty
- 时间线（如 task 有 events）

### 5.3 /newstore/[taskId] saga 步骤指示器

**修改**：`frontend-admin/app/(authed)/newstore/[taskId]/page.tsx`

加 horizontal stepper 显示 saga 12 步骤（参考设计文档 §8.10.1）：
```
PENDING → AUTH_DONE → MEDIA_UPLOADING → COLLECTIONS_CREATING → 
PRODUCTS_PUSHING → GUIDE_DOC_PUSHED → THEME_DEPLOYING → THEME_PUBLISHING → SUCCESS
```

每步：
- 已完成：✓ 绿底
- 当前：进行中 蓝色边框
- 未到：灰色
- FAILED：红色 + 失败步骤后所有步骤标灰

从 task / saga state 读 currentStep（如 task 有 `sagaStep` 字段；如无，按 task 子任务列表的 status 推导）。

### 5.4 /stores 增强

**修改**：`frontend-admin/app/(authed)/stores/page.tsx`

新增：
- 列表行「健康检查」按钮 → 调 `GET /store/{id}/test`（如后端有；如无用 `GET /store/{id}` 当兜底测可达）
  - 成功 toast「店铺正常 + token 有效」
  - 失败 toast.error
- 顶部加「批量操作」dropdown（用 Sprint 1 的 `<DropdownMenu>`）
  - 「批量拉资产」（选中行 → 对每个调资产快照 trigger）
  - 「批量禁用」（选中 → 状态改 INACTIVE，二次确认）
- 加列「checkbox」首列；header 全选；底部 "已选 N" 栏

如批量操作后端 endpoint 不存在，前端 fallback 串行调单店 endpoint。

---

## 6. 启动检查表

每 track 完工时输出：
1. 创建/修改文件清单
2. typecheck 结果（pnpm tsc --noEmit）
3. 后端依赖项是否就绪（如缺则降级方案）

合并后我（编排者）做：
- 跑 mvn compile + pnpm tsc 全量验证
- git commit + push

---

_最后更新：2026-05-03_
