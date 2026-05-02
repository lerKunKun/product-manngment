# 并行改进编排（Sprint 4）

> 编排：2026-05-03（Sprint 1-3 后）
> 用途：剩余 P2/P3 + 后端 ops endpoint + 性能（TanStack Query）+ UX（dark / 移动端）+ 设计系统普及。
> 文件冲突边界：明确按文件 ownership 切分，4 个 track 互不重叠。

---

## 0. Track 划分

| Track | 内容 | 工时 | 主要文件 |
|---|---|---|---|
| **T14** | 后端 4 个 ops endpoint + /admin/ops 真数据 wire + Card 重构 | ~3 PD | 后端 ops audit + admin endpoints + frontend admin/ops/page.tsx |
| **T15** | TanStack Query 集成 + /dashboard 4 kpi 迁移 + Card 化 | ~2.5 PD | (authed)/layout.tsx + dashboard/page.tsx + lib/queries/ + package.json |
| **T16** | Dark mode + 移动端 hamburger drawer | ~2 PD | app/layout.tsx + globals.css + AppShell.tsx |
| **T17** | 4 高频页用 Sprint 3 组件重构（DateRangePicker / Form / Card） | ~2 PD | admin/audit-log + admin/notification-log + forgot-password + reset-password |

**总工时**：~9.5 PD（4 人并行约 1 周）

---

## 1. 文件 Ownership 矩阵

| 文件 | Owner | 其他 track |
|---|---|---|
| `backend-api/.../ops/audit/`（新增 controller / service） | **T14** | 不动 |
| `frontend-admin/app/(authed)/admin/ops/page.tsx` | **T14** | 不动 |
| `frontend-admin/lib/api/auditArchive.ts`（扩展） | **T14** | 不动 |
| `frontend-admin/app/(authed)/layout.tsx` | **T15** | T16 不动该文件，dark mode 走 root layout |
| `frontend-admin/app/(authed)/dashboard/page.tsx` | **T15** | T17 不动 dashboard |
| `frontend-admin/lib/queries/`（新建） | **T15** | 不动 |
| `frontend-admin/package.json` | **T15** | 加 @tanstack/react-query |
| `frontend-admin/app/layout.tsx` | **T16** | 不动 |
| `frontend-admin/app/globals.css` | **T16** | 不动 |
| `frontend-admin/components/layout/AppShell.tsx` | **T16** | 不动；加 theme toggle + hamburger |
| `frontend-admin/app/(authed)/admin/audit-log/page.tsx` | **T17** | 不动 |
| `frontend-admin/app/(authed)/admin/notification-log/page.tsx` | **T17** | 不动 |
| `frontend-admin/app/forgot-password/page.tsx` | **T17** | 不动 |
| `frontend-admin/app/reset-password/page.tsx` | **T17** | 不动 |

---

## 2. T14 详细任务（后端 ops endpoints + /admin/ops 真数据）

### 2.1 后端：新建 `OpsAdminController`
**文件**：`backend-api/src/main/java/com/biou/shopifyhub/ops/audit/OpsAdminController.java`

`@RestController @RequestMapping("/admin")`

端点：
1. `GET /admin/audit-archive` query: `from?` (YYYY-MM) `to?` `status?` → `Result<List<AuditArchiveLog>>`
   - 用 `AuditArchiveLogMapper.selectList(LambdaQueryWrapper)` orderByDesc archiveMonth
2. `GET /admin/audit-archive/{id}/download` → `Result<Map<String, Object>>`
   - 校验 status=SUCCESS 否则抛 BusinessException
   - 调 `FileService.presignGet(bucket, key, Duration.ofMinutes(15))` 生成 R2 presigned URL
   - 返回 `{url, expiresIn: 900, sha256, archiveMonth}`
   - **不要**直接 stream 文件（节省 backend 带宽）；返 presigned URL 让浏览器直拉 R2
3. `GET /admin/ops/backup-status` → `Result<Map<String, Object>>`
   - 查 `MetricsRegistry.getBackupLastSuccess()`（如有 getter）；如无，加 getter 暴露
   - 查 7 天内 audit_archive_log status=FAILED 的 count
   - 查 RDS 备份失败数（暂用 placeholder 0，TODO 后续 backup-notify-log 表）
   - 返回 `{backupLastSuccessSeconds, archiveLastSuccessSeconds, archiveFailedCount7d, backupFailedCount7d}`
4. `POST /admin/audit-archive/run` body `{month: "YYYY-MM"}` → `Result<AuditArchiveLog>`
   - 调 `AuditArchiveScheduler.archive(YearMonth.parse(month))`
   - **去掉 loopback 限制**：管理员通过浏览器可调；用 `@RequireSensitiveOp("AUDIT_ARCHIVE_RUN")` 二次确认
   - 注：`BackupNotifyController` 现有的 loopback `/ops/backup/audit-archive/run` 保留不动（cron 用）

`MetricsRegistry` 加 getter：`public Long getBackupLastSuccessAt()` `public Long getAuditArchiveLastSuccessAt()`（返回 gauge 当前值，单位 unix seconds；如未 set 返 null）。

### 2.2 编译
```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH mvn -DskipTests compile
```
必须 BUILD SUCCESS。

### 2.3 前端 /admin/ops 接真数据 + Card 化
**修改**：`frontend-admin/app/(authed)/admin/ops/page.tsx`

- 把 `auditArchiveApi.list()` 调用从 silent fallback 改为正常调用（端点已上线）
- 新加 `auditArchiveApi.backupStatus()` `auditArchiveApi.download(id)` `auditArchiveApi.runArchive(month, sensitiveToken)`
- 4 个卡片用真数据：
  - 「上次 RDS 备份」格式化 backupLastSuccessSeconds → "X 小时前"
  - 「上次审计归档」用 archiveLastSuccessSeconds 或 audit_archive_log 最新 SUCCESS
  - 「7 天备份失败」backupFailedCount7d
  - 「7 天归档失败」archiveFailedCount7d
- 「下载」按钮启用：点击 → 调 download → 取 url → `window.open(url)`
- 「立即触发归档」按钮启用：弹 dialog 选月份 → 钉钉 6 位码（AUDIT_ARCHIVE_RUN）→ 调 runArchive
- **Card 化**：4 个卡片用 Sprint 3 的 `<Card>` 组件替换内联 `<div className="rounded-lg border ...">`

**修改**：`frontend-admin/lib/api/auditArchive.ts`
- 加 `backupStatus()` `download(id)` `runArchive(month, sensitiveToken)` `requestSensitiveCode/verifySensitive` 方法
- 删除原 silent flag（端点已 ready）

### 2.4 前端 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```
必须 exit 0。

### 不要碰
- T15/T16/T17 各自范围
- 其他 controller / page

### 输出
1. 4 端点 URL + 简述
2. backend mvn compile 结果
3. frontend tsc 结果
4. /admin/ops 截图描述（4 卡片真数据 + 表格 + 下载/触发按钮启用）

---

## 3. T15 详细任务（TanStack Query 集成）

### 3.1 安装依赖
```
cd frontend-admin && pnpm add @tanstack/react-query@5
```

### 3.2 QueryClientProvider 注入
**修改** `frontend-admin/app/(authed)/layout.tsx`：

```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));
  return (
    <QueryClientProvider client={queryClient}>
      {/* 现有 children / AppShell wrapper 保留 */}
      {children}
    </QueryClientProvider>
  );
}
```

如现有 (authed)/layout.tsx 已有内容（如 redirect 校验），先 Read 再合并。

### 3.3 创建 query hooks
**新建** `frontend-admin/lib/queries/dashboard.ts`：

```ts
import { useQuery } from "@tanstack/react-query";
import { productApi } from "@/lib/api/product";
import { storeApi } from "@/lib/api/store";
import { taskApi } from "@/lib/api/task";
import { approvalApi } from "@/lib/api/approval";

export function useDashboardKpis() {
  const products = useQuery({
    queryKey: ["dashboard", "products-total"],
    queryFn: async () => (await productApi.list(1, 1)).total,
  });
  const stores = useQuery({
    queryKey: ["dashboard", "stores-active"],
    queryFn: async () => (await storeApi.list()).filter(s => s.status === "ACTIVE").length,
  });
  const tasksToday = useQuery({
    queryKey: ["dashboard", "tasks-today"],
    queryFn: async () => {
      const today = new Date(); today.setHours(0,0,0,0);
      const all = await taskApi.list(1, 100, { type: "PRODUCT_PUSH" });
      return (all.records ?? []).filter(t => new Date(t.createdAt) >= today).length;
    },
  });
  const pendingApprovals = useQuery({
    queryKey: ["dashboard", "approvals-pending"],
    queryFn: async () => (await approvalApi.myPending()).length,
  });
  return { products, stores, tasksToday, pendingApprovals };
}

export function useFailedTasks(limit = 5) {
  return useQuery({
    queryKey: ["dashboard", "failed-tasks", limit],
    queryFn: async () => (await taskApi.list(1, limit, { status: "FAILED" })).records ?? [],
  });
}
```

### 3.4 dashboard 迁移到 useQuery + Card 化
**修改** `frontend-admin/app/(authed)/dashboard/page.tsx`：

- 删除手写 useEffect + useState fetch 逻辑（4 卡 + 失败任务）
- 改用 `useDashboardKpis()` + `useFailedTasks()`
- 4 卡用 Sprint 3 的 `<Card>` 组件（含 CardHeader/Title/Content）
- loading 用 `<Skeleton>` 替代「—」placeholder
- 「24h 通知发送」section 不变（NotificationChart 内部逻辑不动）

### 3.5 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```
必须 exit 0。

### 不要碰
- AppShell.tsx（T16 owner）
- 其他 page.tsx
- T14/T16/T17 范围

### 输出
1. 安装的版本号
2. layout 改动概述
3. dashboard 迁移前后对比
4. typecheck 结果

---

## 4. T16 详细任务（Dark mode + 移动端 drawer）

### 4.1 Dark mode 基础
**修改** `frontend-admin/app/globals.css`：
- 确认已有 dark theme 变量（如有 `:root.dark { --background: ... }`）；如无，加上 dark mode 颜色变量
- 用 `class` strategy（`html.dark`）

**修改** `frontend-admin/app/layout.tsx`：
- 在 `<html>` 标签 + 一段 inline `<script>` 防 flash：
```tsx
<head>
  <script dangerouslySetInnerHTML={{ __html: `
    try {
      const t = localStorage.getItem("theme");
      const d = t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches);
      if (d) document.documentElement.classList.add("dark");
    } catch {}
  `}} />
</head>
```

### 4.2 Theme toggle button
**修改** `frontend-admin/components/layout/AppShell.tsx`：

header 区在 🔔 button 旁加 theme toggle button：
- 显示 ☀️ (light) / 🌙 (dark) 切换
- 点击 toggle html.dark class + write localStorage
- mount 后用 useState 同步当前主题

```tsx
const [theme, setTheme] = useState<"light"|"dark">("light");
useEffect(() => {
  setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
}, []);
function toggleTheme() {
  const next = theme === "dark" ? "light" : "dark";
  document.documentElement.classList.toggle("dark", next === "dark");
  localStorage.setItem("theme", next);
  setTheme(next);
}
```

### 4.3 移动端 hamburger drawer
**修改** `frontend-admin/components/layout/AppShell.tsx`：

- 添加 `useState<boolean>(false)` 控制 mobileNavOpen
- header 左侧加 hamburger button（仅 < md 显示，用 `md:hidden`）
- 桌面 (`md:flex`) 仍用现有 `<aside w-56>`；移动端用 Sprint 3 的 `<Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen} side="left">` 装下相同 nav
- 点击 nav link 自动关闭 drawer (`setMobileNavOpen(false)`)
- aside 加 `hidden md:flex`（移动端隐藏）

### 4.4 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```
必须 exit 0。

### 不要碰
- T14/T15/T17 范围
- 其他 page.tsx

### 输出
1. globals.css 改动（dark variables）
2. layout.tsx anti-flash script 位置
3. AppShell theme toggle + hamburger drawer 实现概述
4. typecheck 结果

---

## 5. T17 详细任务（4 高频页用 Sprint 3 组件重构）

### 5.1 /admin/audit-log 用 DateRangePicker
**修改** `frontend-admin/app/(authed)/admin/audit-log/page.tsx`：

- import `<DateRangePicker>` from `@/components/ui/DateRangePicker`
- 在过滤栏区域，把现有「from / to 两个 datetime-local input」替换为单个 `<DateRangePicker from={from} to={to} onChange={(f,t)=>{setFrom(f); setTo(t)}} />`
- 保留其他过滤项（userId / module / action / sensitive 三态）
- `import { Card } from "@/components/ui/Card"` — **可选** 把过滤栏 / 表格容器外层包 Card

### 5.2 /admin/notification-log 用 DateRangePicker
**修改** `frontend-admin/app/(authed)/admin/notification-log/page.tsx`：
- 同 5.1 把 from/to 双 input 替换为 `<DateRangePicker>`
- 顶部 3 卡片 stats（今日 SENT/FAILED/PENDING）**改用 Card 组件包**

### 5.3 /forgot-password 用 Form + Card
**修改** `frontend-admin/app/forgot-password/page.tsx`：
- 整个表单包在 `<Card>`（CardHeader + CardTitle "忘记密码" + CardContent + CardFooter）
- 输入区用 `<Form>` + `<FormField label="邮箱" required ...>` + `<FormActions>`
- 错误状态走 FormField 的 `error` prop

### 5.4 /reset-password 用 Form + Card
**修改** `frontend-admin/app/reset-password/page.tsx`：
- 同上结构
- 加密码强度可视化（progress bar 红/黄/绿，前端纯 CSS）
- 提交成功后明确「立即去登录」按钮
- token 失效给友好提示 + 「重新发请求」入口

### 5.5 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```
必须 exit 0。

### 不要碰
- T14（admin/ops）/T15（dashboard, layout）/T16（AppShell, root layout, globals.css）
- 其他 page.tsx

### 输出
1. 4 个文件改动清单
2. typecheck 结果
3. 每页改造前后简短对比（哪些 inline DOM 替换为组件）

---

## 6. 启动检查表

每 track 完工时输出：
1. 创建/修改文件清单
2. typecheck / compile 结果
3. 任何 endpoint / 字段缺失的 fallback 决策

合并后我做：
- backend mvn compile + frontend tsc 全量验证
- git commit + push

---

_最后更新：2026-05-03_
