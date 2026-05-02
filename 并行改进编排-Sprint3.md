# 并行改进编排（Sprint 3）

> 编排：2026-05-03
> 用途：Sprint 1+2 后剩余 P1/P2 + 后端补 endpoint + 设计系统继续完整化。
> 文件冲突边界：T10 owns 后端 controller + 前端 task.ts/store.ts；其他 track 不动那两个 client。

---

## 0. Track 划分

| Track | 内容 | 工时 | 主要文件 |
|---|---|---|---|
| **T10** | 后端补 5 个端点 + 前端开关切真 | ~3 PD | TaskController / StoreController / AssetSnapshotController + lib/api/task.ts / store.ts |
| **T11** | /products/[id] 加 2 历史 tab + /cross-auth 增强 | ~2 PD | products/[id]/page.tsx + cross-auth/page.tsx + ProductHistoryTab 组件 |
| **T12** | /inbox 优化 + /admin/ops 备份监控面板 | ~2.5 PD | inbox/page.tsx + 新建 admin/ops/page.tsx + audit-archive-log API client |
| **T13** | 设计系统补 6 组件（Combobox/DateRangePicker/Sheet/Tooltip/Card/Form） | ~2 PD | components/ui/ 新增 6 个 |

**总工时**：~10 PD（4 人并行约 1 周；本次约 1.5 小时）

---

## 1. T10 详细任务（后端 5 个端点）

### 1.1 POST /task/{id}/retry
**文件**：`backend-api/src/main/java/com/biou/shopifyhub/push/TaskController.java`

新增端点：
```java
@PostMapping("/{id}/retry")
public Result<Long> retry(@PathVariable Long id) {
    Task t = mustGet(id);
    if (!"FAILED".equals(t.getStatus())) {
        throw new BusinessException(ResultCode.CONFLICT, "仅 FAILED 任务可重试");
    }
    // 简化：把 status 改回 PENDING + 重置 attempt 让消费者重新拉
    t.setStatus("PENDING");
    t.setRetryCount(t.getRetryCount() == null ? 1 : t.getRetryCount() + 1);
    t.setLastError(null);
    taskMapper.updateById(t);
    // 重新投 RabbitMQ（type 决定路由 key）— 如有 publishing service 调用之；否则仅改 DB 等下次扫
    return Result.ok(t.getId());
}
```
- 如 Task entity 没有 `retryCount` / `lastError` 字段，先 grep 看实际字段；用现有可用字段
- 如有 RabbitMQ 重新发布服务（如 `TaskPublisher`），调用之；否则注释「等待 scheduler 拾取 PENDING」

### 1.2 GET /task?parentTaskId=...
**文件**：同 TaskController

修改现有 list 端点签名加 query 参数 `parentTaskId`：
```java
@GetMapping
public Result<...> list(@RequestParam(required = false) String type,
                        @RequestParam(required = false) String status,
                        @RequestParam(required = false) Long storeId,
                        @RequestParam(required = false) Long parentTaskId,
                        ...)
```
在 LambdaQueryWrapper 内 `if (parentTaskId != null) q.eq(Task::getParentTaskId, parentTaskId);`

### 1.3 POST /asset-snapshot/trigger
**文件**：`backend-api/src/main/java/com/biou/shopifyhub/asset/AssetSnapshotController.java`

新增：
```java
@PostMapping("/trigger")
public Result<Long> trigger(@RequestBody TriggerReq req) {
    // 创建 asset_snapshot 行 status=PENDING + 通过 RabbitMQ 投 worker
    // 如已有 service 方法（如 AssetSnapshotService.requestPull(storeId)）调用之
    // 返回 snapshotId
}
public record TriggerReq(Long storeId) {}
```
- 先 grep 现有 service / 触发逻辑（grep "trigger\|requestPull\|/pull/theme"）；复用既有
- 如完全没有，简化版：插一行 asset_snapshot 表（先看实体字段）+ TODO「实际触发 worker 待 W2-AST 完整化」

### 1.4 POST /store/{id}/disable
**文件**：`backend-api/src/main/java/com/biou/shopifyhub/store/StoreController.java`

```java
@RequireSensitiveOp("STORE_BATCH_DISABLE")
@PostMapping("/{id}/disable")
public Result<Void> disable(@PathVariable Long id) {
    Store s = storeMapper.selectById(id);
    if (s == null) return Result.error(ResultCode.NOT_FOUND);
    s.setStatus("INACTIVE");
    storeMapper.updateById(s);
    return Result.ok();
}
```
确认 Store entity 有 `status` 字段（应有）。

### 1.5 GET /store/{id}/test
**文件**：同 StoreController

```java
@GetMapping("/{id}/test")
public Result<Map<String, Object>> test(@PathVariable Long id) {
    Store s = storeMapper.selectById(id);
    if (s == null) return Result.error(ResultCode.NOT_FOUND);
    // 简化版：不真调 Shopify shop.json（避免依赖外部网络），仅校验 token 字段非空 + status=ACTIVE
    Map<String,Object> r = new LinkedHashMap<>();
    r.put("storeId", id);
    r.put("status", s.getStatus());
    r.put("tokenPresent", s.getEncryptedToken() != null && !s.getEncryptedToken().isBlank());
    r.put("healthy", "ACTIVE".equals(s.getStatus()));
    // 真 Shopify 调用留 v1.1：调 ShopifyApiClient.getShop(id)
    return Result.ok(r);
}
```

### 1.6 前端开关切真
**修改**：
- `frontend-admin/lib/api/task.ts` — `TASK_RETRY_AVAILABLE = true`
- `frontend-admin/lib/api/store.ts` — `STORE_DISABLE_AVAILABLE = true`、`STORE_TEST_ENDPOINT_AVAILABLE = true`、`ASSET_TRIGGER_AVAILABLE = true`
- `taskApi.retry(id)` 实际调用 `/task/{id}/retry`（应已有，T9 占位实现）
- `storeApi.healthCheck` 改为调真 `/store/{id}/test` 而非 list 兜底
- 加 `assetApi.trigger(storeId)`：POST `/asset-snapshot/trigger`

不要碰前端其他页面（按钮 disabled 改 enabled 自动生效，因为已经看 *_AVAILABLE 开关）。

### 不要碰
- 前端 page.tsx（除 lib/api/）
- 其他后端 controller / service
- AppShell / AppShell 的 NAV

### 输出
1. 5 个 endpoint 清单 + URL
2. backend mvn compile 应 SUCCESS
3. frontend tsc exit 0
4. 报告任何「字段不存在」「service 缺失」的简化决策

---

## 2. T11 详细任务（产品历史 tab + cross-auth 增强）

### 2.1 /products/[id] 加 2 历史 tab

新建组件 `frontend-admin/components/product/ProductHistoryTabs.tsx`：

包含两个 tab（用 Sprint 1 的 `<Tabs>`）：

**「快照历史」**：
- 调 `snapshotApi.list({ productId: id, size: 50 })`（如 snapshotApi 不支持 productId 过滤，前端拉全部 filter）
- 表格：snapshot id / store / status badge / created_at / 详情链接（→ /snapshots/[id]）

**「推送历史」**：
- 调 `taskApi.list({ type: "PRODUCT_PUSH" })` 后前端按 `payload.productId === id` filter（如 task list 不支持 productId 过滤）
- 表格：task id / store / status / created_at / 错误简介 / 详情链接

**修改** `frontend-admin/app/(authed)/products/[id]/page.tsx`：
- 在已有的 tabs 中追加两个 tab：「快照历史」「推送历史」
- tab 内容挂载 `<ProductHistoryTabs productId={id} />`

如已有 tab 是用 Sprint 1 的 `<Tabs>`，直接加 trigger + content；如手写的就 inline 加。

### 2.2 /cross-auth 增强

**修改**：`frontend-admin/app/(authed)/cross-auth/page.tsx`

新增：
- **顶部「24h 内即将到期」section**：
  - 列表 filter `isExpiringSoon(g)`（已有该函数）
  - 如有 ≥ 1 条，置顶展示 amber 警告卡 + 列表 + 「快速续期」按钮
  - 如 0 条，不显示该 section
- **「续期」按钮**（每行 status=ACTIVE 时）：
  - 钉钉 6 位码二次确认（action="CROSS_AUTH_RENEW"，复用现有 sensitive 流程）
  - 调用 `crossAuthApi.grant(...)` 重新创建（同样的 userId/scope/expiresAt=now+7d）— **不删除旧记录**，让旧的自然到期
  - 成功 toast「已续期 7 天」+ 刷新
  - 如后端未支持续期专用端点，简化为「直接调 grant 创建新记录」
- **「批量授权」按钮**（顶部）：
  - 暂留 placeholder + tooltip「v1.1 支持」（实现成本高，单次授权已可满足 90% 场景）

### 不要碰
- 后端任何文件（T10 owner）
- AppShell / NAV

### 输出
1. 修改/创建文件清单
2. frontend tsc exit 0
3. snapshot / task list API 是否支持 productId 过滤的 verify 报告

---

## 3. T12 详细任务（/inbox 优化 + /admin/ops 备份监控）

### 3.1 /inbox 按 category 过滤 + 时间分组

**修改**：`frontend-admin/app/(authed)/inbox/page.tsx`

新增：
- 顶部 toolbar 加 category 过滤 dropdown（基于 inapp_message 的 event_code 第一个 `_` 前缀，或硬编码 6 个 category：邀请 / 店铺 / 推送 / 审批 / 运维 / 系统）
- 列表按时间分组：今天 / 昨天 / 本周 / 更早 — 每组显示 group header + items
- 用 Sprint 1 的 `<Badge>` 给 unread 项加红点
- 如分组组内 0 条，不渲染该组

实现建议：
```ts
function groupByDay(items: InappMessage[]): Record<string, InappMessage[]> {
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - today.getDay());
  // ...
}
```

### 3.2 /admin/ops 备份监控面板

**新建 API client** `frontend-admin/lib/api/auditArchive.ts`：
```ts
import { api } from "./client";

export type AuditArchiveLog = {
  id: number;
  archiveMonth: string;  // YYYY-MM
  rowCount?: number;
  startId?: number;
  endId?: number;
  r2Bucket: string;
  r2Key: string;
  bytesCompressed?: number;
  bytesEncrypted?: number;
  sha256?: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  errorMsg?: string;
  startedAt: string;
  finishedAt?: string;
};

export const auditArchiveApi = {
  // 列表（后端可能没有专门 endpoint；先 grep；如缺，前端按 sql 列表 fallback：先用 audit-log endpoint + 假数据）
  list: () => api.get<AuditArchiveLog[]>(`/admin/audit-archive`),  // TODO 后端 endpoint 待定
  // 手动触发（loopback only - 前端 admin 调用会被拒绝；标记 disabled + 解释）
};
```

**新建页面** `frontend-admin/app/(authed)/admin/ops/page.tsx`：

UI:
- 顶部 4 卡片：
  - 上次 RDS 备份时间（无 API → 显示 "—"，注「需后端补 GET /admin/ops/backup-status」）
  - 上次审计归档时间（取 audit_archive_log 最新 SUCCESS）
  - 最近备份失败次数（最近 7 天）
  - 最近归档失败次数（同上）
- 「audit_archive_log 列表」表格：每月一行 / status badge / r2_key / sha256 缩略 (前 10 字符) / row_count / size / 开始-结束时间 / 「下载」按钮（disabled + tooltip「需 backend 补 presigned download endpoint」）
- 顶部「立即触发归档」按钮（disabled + tooltip「loopback only，需 SSH 节点 A 调用」）

如 `/admin/audit-archive` endpoint 不存在，整页显示 EmptyState「需后端补 audit_archive endpoint」+ 加菜单项链接到 SOP 文档。

**AppShell.tsx** — **不动**（T12 不加菜单，留 Sprint 4 决定）。**或者**在「系统」组末尾加 `{ href: "/admin/ops", label: "备份归档" }` — **建议加**，但**用 Edit 精确替换 NAV_GROUPS 中「系统」组的 items 数组**。

### 不要碰
- 后端任何文件
- T10 / T11 / T13 各自的范围
- 其他页面

### 输出
1. 修改/创建文件清单
2. frontend tsc exit 0
3. 后端缺的 endpoint 清单（auditArchive list / backup-status / 等）

---

## 4. T13 详细任务（设计系统补 6 组件）

新建 `frontend-admin/components/ui/`：

### 4.1 Combobox.tsx
input + 下拉建议列表（用 keyboard ↑↓Enter 导航）。
```tsx
<Combobox
  value={value}
  onChange={setValue}
  options={[{value:'1', label:'选项1'}]}
  placeholder="搜索..."
/>
```

### 4.2 DateRangePicker.tsx
两个 datetime-local input + 快捷按钮（今天/昨天/本周/本月/最近 7 天/最近 30 天）。
```tsx
<DateRangePicker
  from={from}
  to={to}
  onChange={(from, to) => ...}
/>
```

### 4.3 Sheet.tsx
右侧抽屉（移动端 / 桌面端右侧详情用）。基于 `<dialog>` + transition。
```tsx
<Sheet open onOpenChange={setOpen} side="right">
  <SheetHeader>...</SheetHeader>
  <SheetContent>...</SheetContent>
</Sheet>
```

### 4.4 Tooltip.tsx
hover / focus 显示小气泡。CSS-only 也可（::after pseudo），但 React 版便于内容富 markup。
```tsx
<Tooltip content="说明文字">
  <button>...</button>
</Tooltip>
```

### 4.5 Card.tsx
统一卡片容器（替换手写 `<div className="rounded-lg border ...">`）。
```tsx
<Card>
  <CardHeader>
    <CardTitle>标题</CardTitle>
    <CardDescription>说明</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>...</CardFooter>
</Card>
```

### 4.6 Form.tsx
配 react-hook-form 的简单 wrapper（不强制 react-hook-form，只做 layout）：
```tsx
<Form onSubmit={...}>
  <FormField label="名称" required error={errors.name}>
    <input ... />
  </FormField>
  <FormActions>
    <button type="submit">保存</button>
    <button type="button">取消</button>
  </FormActions>
</Form>
```

### 公共
- 每组件 ≤ 80 行，纯 React + TypeScript
- 不引入新 npm 包（除非 react-hook-form 已在 package.json）
- 命名导出，使用 `cn` 工具
- **不要**改任何现有页面（避免冲突）；只新建 components

### 不要碰
- 任何 app/ 下的页面
- 后端
- AppShell

### 输出
1. 6 个新组件文件清单
2. frontend tsc exit 0
3. 简短用法 demo（每组件 5 行示例代码）

---

## 5. 共享文件冲突管理

| 文件 | Owner | 其他 track |
|---|---|---|
| `AppShell.tsx` | **T12**（加 /admin/ops 菜单） | T10/T11/T13 不动 |
| `lib/api/task.ts` | **T10**（开关切真 + retry 真调用） | 其他 track 不动 |
| `lib/api/store.ts` | **T10** | 其他 track 不动 |
| `app/(authed)/products/[id]/page.tsx` | **T11**（加 2 tab） | T10/T12/T13 不动 |
| `app/(authed)/cross-auth/page.tsx` | **T11**（24h 置顶 + 续期） | 其他 track 不动 |
| `app/(authed)/inbox/page.tsx` | **T12** | 其他 track 不动 |
| `backend TaskController/StoreController/AssetSnapshotController` | **T10** | 其他 track 不动 |

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
