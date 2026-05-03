# 并行改进编排（Sprint 8）

> 编排：2026-05-03
> 用途：i18n v2 推到 root + 5 页扩展 + Playwright 扩 4 spec + 后端测试扩到 4 controller + 依赖升级安全审计
> 风险控制：T33 仅升 patch 版本，避免 major/minor 引入 breaking change

---

## 0. Track 划分

| Track | 内容 | 工时 | 主要文件 |
|---|---|---|---|
| **T30** | i18n v2：I18nProvider 推 root + 5 高频页 t() 化 + messages 扩到 ~150 key | ~3 PD | app/layout.tsx + messages.ts + 5 页 page.tsx |
| **T31** | Playwright 4 新 spec（cross-auth / inbox / orgs / dark-mode + 完善 helper） | ~2 PD | e2e/*.spec.ts + e2e/helpers/* |
| **T32** | 后端测试扩到 4 controller（NotificationLog / SysAuditLog / SysRole / BackupNotify） | ~2.5 PD | src/test/java/.../notification + audit + rbac + ops |
| **T33** | 依赖升级（patch + 安全 audit）+ README 加安全 section | ~1.5 PD | package.json + pnpm-lock + pom.xml + README |

**总工时**：~9 PD（4 人并行约 1 周）

---

## 1. 文件 Ownership

| 文件 | Owner |
|---|---|
| `frontend-admin/app/layout.tsx` | T30（推 I18nProvider；保留 T16 anti-flash script 不动） |
| `frontend-admin/lib/i18n/messages.ts` | T30（扩到 ~150 key） |
| `frontend-admin/app/login/page.tsx` | T30 |
| `frontend-admin/app/(authed)/cross-auth/page.tsx` | T30 |
| `frontend-admin/app/(authed)/approvals/page.tsx` | T30 |
| `frontend-admin/app/(authed)/tasks/page.tsx` | T30 |
| `frontend-admin/app/(authed)/admin/audit-log/page.tsx` | T30 |
| `frontend-admin/app/(authed)/layout.tsx` | T30（拆 I18nProvider 出去） |
| `frontend-admin/e2e/cross-auth.spec.ts` `inbox.spec.ts` `orgs.spec.ts` `dark-mode.spec.ts` | T31 |
| `backend-api/src/test/java/.../notification/NotificationLogControllerTest.java` 等 4 个 | T32 |
| `frontend-admin/package.json + pnpm-lock.yaml` | T33 |
| `backend-api/pom.xml` | T33 |
| `README.md` | T33 |

---

## 2. T30 详细任务（i18n v2）

### 2.1 推 I18nProvider 到 root

**修改** `frontend-admin/app/layout.tsx`

先 Read 看现有结构（含 T16 anti-flash script）。

策略：
- root layout 是 RSC（无 "use client"）— 不能直接放 hooks
- 新建 `frontend-admin/components/Providers.tsx`（client component）：
  ```tsx
  "use client";
  import { I18nProvider } from "@/lib/i18n/context";
  export function RootProviders({ children }: { children: React.ReactNode }) {
    return <I18nProvider>{children}</I18nProvider>;
  }
  ```
- root layout body 内包 `<RootProviders>`
- `(authed)/layout.tsx` 删除自己包的 `<I18nProvider>`（已上提到 root）

注意：保留 T16 anti-flash inline script 不动。

### 2.2 messages.ts 扩展

把现有 ~50 key 扩到 ~150：

新增 namespace（每个 ~15-20 key × zh + en）：
- `crossAuth.*` — title / desc / status filter labels / action buttons / 24h warning / renew button
- `approvals.*` — tab labels / status filter / type labels / action buttons / empty state
- `tasks.*` — column headers / status badge labels / retry/cancel / auto-refresh toggle / parent/child
- `auditLog.*` — column headers / filter labels / export button / sensitive checkbox
- `inbox.*` — tab / category labels / time group labels (今天/昨天/本周/更早) / mark-all-read
- `login.*` — 已有，扩 description / errors

更具体 key 名以 spec 而定；尽量复用 common.* 的通用词。

### 2.3 5 页 t() 化

**login** (`app/login/page.tsx`)：
- 标题 / 用户名 / 密码 / 登录 / 忘记密码 / 钉钉扫码登录 — 全部 useI18n + t()
- 验证错误信息（如客户端校验）也 t()
- 不动鉴权 / API 调用逻辑

**cross-auth** (`app/(authed)/cross-auth/page.tsx`)：
- 标题 / 描述 / 状态过滤 button labels / 表头 / 24h 警告卡 / 续期 / 撤销 / 批量授权
- 状态 label 建议加到 `lib/api/crossAuth.ts` STATUS_BADGE 用 t() — 或在 page 内本地映射
- 不动业务逻辑（T11 续期 / 钉钉 6 位码）

**approvals 列表** (`app/(authed)/approvals/page.tsx`)：
- 标题 / tab labels (我审批的 / 我提交的 / 全部) / 状态过滤 / 表头 / 撤回按钮
- 不动 T8 Breadcrumb / T17 / T20 a11y

**tasks** (`app/(authed)/tasks/page.tsx`)：
- 标题 / 表头 / 状态 badge / 自动刷新 toggle / 重试 / 取消 / 展开子任务 / 空状态
- 不动 T9/T10/T19/T23 useQuery 和业务逻辑

**admin/audit-log** (`app/(authed)/admin/audit-log/page.tsx`)：
- 标题 / 过滤 labels / 表头 / 敏感 checkbox / 导出 button
- 不动 T17 DateRangePicker / Card / T19 export 逻辑

### 2.4 typecheck

```
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T31 / T32 / T33 范围
- T16 anti-flash script
- T23 useQuery 业务逻辑
- T27 已 t() 化的 dashboard / NAV
- 后端

### 输出
1. messages.ts 总 key 数（zh + en 各 ~150）
2. RootProviders 组件位置
3. (authed)/layout.tsx 改动（删除 I18nProvider）
4. 5 页改造概述（每页改了多少处文案）
5. tsc 结果

---

## 3. T31 详细任务（Playwright 4 新 spec）

### 3.1 完善 helper

**修改** `frontend-admin/e2e/helpers/auth.ts`（如已建）

可能加 `logout()` helper、`waitForToast(message)` helper。

### 3.2 4 新 spec

**新建** `frontend-admin/e2e/cross-auth.spec.ts`：
```ts
test("cross-auth page loads + status filter works", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/cross-auth");
  await expect(page.getByRole("heading", { name: /跨公司授权|cross/i })).toBeVisible();
  // 点击 ACTIVE 过滤
  const activeBtn = page.getByRole("button", { name: /^生效$|^active$/i });
  if (await activeBtn.isVisible()) await activeBtn.click();
  // 列表区域可见或显示空状态
  await expect(page.locator("text=暂无").or(page.locator("table")).first()).toBeVisible({ timeout: 5000 });
});
```

**新建** `frontend-admin/e2e/inbox.spec.ts`：
```ts
test("inbox page loads + tab switch", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: /通知中心|inbox/i })).toBeVisible();
  // 切换 unread tab
  const unreadTab = page.getByRole("button", { name: /未读|unread/i });
  if (await unreadTab.isVisible()) {
    await unreadTab.click();
    // 不崩
    await expect(page.getByRole("heading", { name: /通知/i })).toBeVisible();
  }
});
```

**新建** `frontend-admin/e2e/orgs.spec.ts`：
```ts
test("orgs page loads + tree node selectable", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/orgs");
  await expect(page.getByRole("heading", { name: /组织|org/i }).first()).toBeVisible();
  // 树节点点击
  const firstNode = page.locator(".tree-node, [role=treeitem]").first();
  if (await firstNode.isVisible()) {
    await firstNode.click();
    // 右侧详情区域出现 "节点 ID" 之类标签
    await expect(page.locator("text=tenantId").or(page.locator("text=parent"))).toBeVisible();
  }
});
```

**新建** `frontend-admin/e2e/dark-mode.spec.ts`：
```ts
test("dark mode toggle persists across reload", async ({ page }) => {
  await loginAsAdmin(page);
  // 初始 light
  let isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  // 切换
  await page.getByRole("button", { name: /切换主题/ }).click();
  isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  expect(isDark).toBe(true);
  // 刷新后保持
  await page.reload();
  isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  expect(isDark).toBe(true);
});
```

注意：所有 selector 用 fallback（label / placeholder / role / text 多重 or-chain），保证现有页面不论 i18n 是否生效都能命中。

### 3.3 typecheck

```
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T30 / T32 / T33 范围
- 已有 e2e spec / config
- AppShell

### 输出
1. 4 新 spec + helper 改动清单
2. selector 策略（多重 or-chain 兼容 i18n）
3. tsc 结果

---

## 4. T32 详细任务（后端测试扩展至 4 controller）

### 4.1 测试策略

延续 T28 的策略 C：`@SpringBootTest @Transactional @Rollback` 自动回滚。

### 4.2 4 个测试文件

**新建** `backend-api/src/test/java/com/biou/shopifyhub/notification/subscription/NotificationLogControllerTest.java`

`@SpringBootTest @AutoConfigureMockMvc(addFilters=false) @Transactional`

3 case：
- list_with_filters_returns_paginated — POST /admin/notification-log query params + 200 + Page 结构
- get_by_id_returns_log
- stats_returns_status_counts

**新建** `backend-api/src/test/java/com/biou/shopifyhub/audit/SysAuditLogControllerTest.java`

3 case：
- list_with_filters
- get_by_id
- export_returns_csv（用 MockMvc 拿 stream → 检查 Content-Disposition + Body 含 BOM）

**新建** `backend-api/src/test/java/com/biou/shopifyhub/rbac/SysRoleControllerTest.java`

4 case：
- list_returns_all_roles
- get_role_detail_with_permissions_and_user_count
- create_custom_role
- update_permissions_blocked_for_builtin

**新建** `backend-api/src/test/java/com/biou/shopifyhub/ops/audit/BackupNotifyControllerTest.java`

3 case：
- notify_fail_loopback_only — 用 MockMvc + X-Forwarded-For:10.0.0.1 → 期望 403
- notify_fail_loopback_passes — X-Forwarded-For:127.0.0.1 → 期望 200
- audit_archive_run_loopback — 同上

注意：可能需要 `@WithMockUser` 或 `addFilters=false` 来跳过 JWT，先用 addFilters=false 简化。

### 4.3 跑测试

```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
  mvn test -Dtest='NotificationLogControllerTest,SysAuditLogControllerTest,SysRoleControllerTest,BackupNotifyControllerTest'
```

如沙箱拒绝 mvn test，至少跑 `mvn -DskipTests compile` 验证测试编译通过。

### 不要碰
- src/main/java/
- T30 / T31 / T33 范围

### 输出
1. 4 个 test 文件 + 总用例数（13+ case）
2. mvn compile 结果（含 test classes）
3. mvn test 跑结果（如能跑）
4. 测试命名 + 路径

---

## 5. T33 详细任务（依赖升级 + 安全审计）

### 5.1 前端 audit + patch 升级

```
cd frontend-admin && pnpm audit --audit-level moderate
```

记录 audit 结果（高/严重漏洞数）。

仅升 **patch 版本**（避免 minor/major 引入 breaking change）：
```
cd frontend-admin && pnpm update --latest=false
```

或更安全：手动只升以下场景：
- 高/严重 vulnerability 的包（必升）
- patch (X.Y.Z+1) 的稳定升级

不要：
- 升 React 19 → 20（major）
- 升 Next.js 15 → 16（major）
- 升 Tailwind 3 → 4（已升过）

### 5.2 后端 audit + patch 升级

```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
  mvn versions:display-dependency-updates -DprocessDependencyManagement=false
```

记录有更新的依赖列表 + 当前/最新版本。

仅升 **patch 版本**：
- Spring Boot 3.3.x → 3.3.最新（如 3.3.6 → 3.3.10）
- MyBatis-Plus 3.5.x → 3.5.最新
- 其它库同理

不要：
- 升 Spring Boot 3.3 → 3.4（minor）
- 升 Java 21 → 24（major）

用 mvn 命令或手动改 pom.xml `<version>` 字段。

### 5.3 验证编译 + 测试

```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH mvn -DskipTests compile
cd frontend-admin && pnpm tsc --noEmit
```

必须 BUILD SUCCESS / exit 0。如有 breaking change，回退该升级。

### 5.4 README 加安全审计 section

在 README 末尾加 section「## 安全审计」：

```markdown
## 安全审计

### 依赖审计（每月跑一次）

```
cd frontend-admin && pnpm audit --audit-level moderate
cd backend-api && mvn versions:display-dependency-updates
```

### 已知漏洞处置原则

- **CRITICAL / HIGH**：立即升 patch（同 major/minor），48h 内修
- **MODERATE**：评估业务影响，下个 sprint 修
- **LOW / INFO**：技术债登记，不阻塞

### 安全工具

- pre-commit hook（`.githooks/pre-commit`）—— 4 项检查
- GitHub Trivy scan（`.github/workflows/ci.yml` security-scan job）
- 钉钉告警 BACKUP_FAIL / HIGH_RISK_OP 等关键事件
```

### 不要碰
- T30 / T31 / T32 范围
- 后端业务代码 / 前端 page

### 输出
1. pnpm audit 结果（漏洞数 + 严重度）
2. mvn updates 报告（有多少依赖可升）
3. 实际升级清单（哪些 patch 升了）
4. backend mvn compile + frontend tsc 结果
5. README 改动概述

---

## 6. 启动检查表

每 track 完工时输出：
1. 创建/修改文件清单
2. compile / tsc / mvn test 结果
3. 已知 fallback / TODO

合并后我做：
- backend mvn compile + frontend tsc 全量验证
- git commit + push

---

_最后更新：2026-05-03_
