# 并行改进编排（Sprint 7）

> 编排：2026-05-03
> 用途：完整化 datasource 管理 + i18n 试点（轻量自建版本）+ 后端关键 controller 测试 + 前端 Playwright e2e 试点
> 风险控制：i18n 不走 next-intl middleware（避免路由重构），用 useContext + messages 字典自建轻量版

---

## 0. Track 划分

| Track | 内容 | 工时 | 主要文件 |
|---|---|---|---|
| **T26** | 后端扩展 TenantDataSource entity/controller + 前端 /admin/datasources 真表格 | ~2.5 PD | backend tenant 包 + frontend datasource.ts + datasources/page.tsx |
| **T27** | i18n 试点（context + messages + lang switcher + 4 处页面双语） | ~2 PD | lib/i18n/* + login + dashboard + AppShell NAV |
| **T28** | 后端关键 controller 测试（ApprovalEngine/Controller + InappService） | ~2 PD | backend src/test/java/.../approval + inapp |
| **T29** | 前端 Playwright e2e 试点（3 spec + ci.yml playwright job） | ~2.5 PD | playwright.config.ts + e2e/* + .github/workflows/ci.yml |

**总工时**：~9 PD（4 人并行约 1 周）

---

## 1. 文件 Ownership

| 文件 | Owner |
|---|---|
| `backend-api/.../tenant/entity/SysTenantDatasource.java` | T26（如需扩展字段） |
| `backend-api/.../tenant/controller/TenantDataSourceController.java` | T26 |
| `backend-api/.../tenant/controller/TenantDataSourceAdminController.java`（新建） | T26 |
| `frontend-admin/lib/api/datasource.ts` | T26 |
| `frontend-admin/app/(authed)/admin/datasources/page.tsx` | T26 |
| `frontend-admin/lib/i18n/`（新建） | T27 |
| `frontend-admin/app/login/page.tsx` | T27 |
| `frontend-admin/app/(authed)/dashboard/page.tsx` | T27（仅文案 t() 化） |
| `frontend-admin/components/layout/AppShell.tsx` | T27（NAV 文案 + lang switcher） |
| `backend-api/src/test/java/com/biou/shopifyhub/approval/` | T28 |
| `backend-api/src/test/java/com/biou/shopifyhub/notification/inapp/` | T28 |
| `frontend-admin/playwright.config.ts` | T29 |
| `frontend-admin/e2e/`（新建） | T29 |
| `frontend-admin/package.json` | T29（add @playwright/test） |
| `.github/workflows/ci.yml` | T29（加 playwright job） |

T27 + T23 都改 AppShell.tsx：T23 已完成；T27 在已有 AppShell 上加 lang switcher button + NAV 文案 i18n（仅追加，不破坏 T23 useUnreadInboxCount + T16 theme toggle）。

---

## 2. T26 详细任务（datasource 完整化）

### 2.1 后端：扩展 controller

**新建** `backend-api/src/main/java/com/biou/shopifyhub/tenant/controller/TenantDataSourceAdminController.java`

`@RestController @RequestMapping("/admin/tenant/datasource-admin")` — 与现有 `/admin/tenant/datasource`（仅返 keys）并存，**不破坏现有**。

端点：
1. `GET /admin/tenant/datasource-admin` — 列出 sys_tenant_datasource 表全部行（password 脱敏成 `****`）
2. `POST /admin/tenant/datasource-admin` body `{tenantId, tenantCode, jdbcUrl, username, password, poolMin?, poolMax?}` → 加密 password (用 AesGcmUtil + ENCRYPT_KEY_AES_GCM) 后插表 → 触发 reload → 返 `Result<Long>` (id)
3. `DELETE /admin/tenant/datasource-admin/{id}` — 软删（status=DISABLED）+ 触发 reload
4. `PUT /admin/tenant/datasource-admin/{id}` body `{poolMin?, poolMax?, status?}` — 更新 pool 配置（不改 url/credentials）+ reload

注意：
- 加 `@RequireSensitiveOp("DATASOURCE_REGISTER")` 给 POST + DELETE
- list 返 entity + password 字段返 `"****"`（永远不返真实值，仅前端显示占位）
- 用现有 `SysTenantDatasourceMapper`（grep 确认存在；不存在则用 JdbcTemplate）
- 用 `TenantDataSourceManager`（已有）的 reload 方法触发刷新

### 2.2 前端 lib/api/datasource.ts 扩展

```ts
export type SysTenantDatasource = {
  id: number;
  tenantId: number;
  tenantCode: string;
  jdbcUrl: string;
  username: string;
  password?: string;  // "****" 占位，永不返真值
  poolMin: number;
  poolMax: number;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
};

export type RegisterDatasourceReq = {
  tenantId: number;
  tenantCode: string;
  jdbcUrl: string;
  username: string;
  password: string;
  poolMin?: number;
  poolMax?: number;
};

export const datasourceAdminApi = {
  list: () => api.get<SysTenantDatasource[]>(`/admin/tenant/datasource-admin`),
  create: (body: RegisterDatasourceReq, sensitiveToken?: string) =>
    api.post<number>(`/admin/tenant/datasource-admin`, body,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken }} : undefined),
  remove: (id: number, sensitiveToken?: string) =>
    api.del<void>(`/admin/tenant/datasource-admin/${id}`,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken }} : undefined),
  update: (id: number, body: { poolMin?: number; poolMax?: number; status?: string }) =>
    api.put<void>(`/admin/tenant/datasource-admin/${id}`, body),
  // 复用敏感操作端点
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),
};

// 保留 datasourceApi（旧 /admin/tenant/datasource 仅返 keys）做 reload 用
```

### 2.3 前端 /admin/datasources 改用真表格

**修改** `frontend-admin/app/(authed)/admin/datasources/page.tsx`

- 列表用 `datasourceAdminApi.list()` 拿完整字段
- 表格列：tenantCode / tenantId / jdbcUrl（脱敏 user:pass）/ username / pool min/max / status badge / createdAt / 操作（删除）
- 「+ 注册新租户」dialog：完整 form（tenantId / tenantCode / jdbcUrl / username / password / poolMin / poolMax）+ 钉钉 6 位码（DATASOURCE_REGISTER）
- 删除 → 钉钉 6 位码（DATASOURCE_REGISTER）→ DELETE
- 顶部「Reload 路由」按钮保留（旧 `datasourceApi.reload()` 调旧端点）
- 用 Sprint 3 的 `<Form>` `<FormField>` `<Card>` `<Badge>`

### 2.4 编译

```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH mvn -DskipTests compile
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰

- T27/T28/T29 范围

### 输出

1. backend mvn compile 结果
2. frontend tsc 结果
3. `SysTenantDatasourceMapper` 是否存在（决定是否走 JdbcTemplate）
4. 改动概述

---

## 3. T27 详细任务（i18n 轻量试点）

### 3.1 lib/i18n 基础设施

**新建** `frontend-admin/lib/i18n/messages.ts`：

```ts
export const messages = {
  "zh-CN": {
    // 通用
    "common.save": "保存",
    "common.cancel": "取消",
    "common.delete": "删除",
    "common.confirm": "确认",
    "common.loading": "加载中…",
    "common.empty": "暂无数据",
    
    // NAV
    "nav.home": "首页",
    "nav.business": "业务",
    "nav.products": "产品库",
    "nav.stores": "店铺管理",
    "nav.partner-stores": "合作者店铺池",
    "nav.newstore": "一键开店",
    "nav.assets": "资产",
    "nav.snapshots": "产品快照",
    "nav.assets-snapshot": "资产快照",
    "nav.templates": "模板库",
    "nav.flow": "流程",
    "nav.approvals": "审批中心",
    "nav.invitations": "临时员工邀请",
    "nav.cross-auth": "跨公司授权",
    "nav.my": "我的",
    "nav.inbox": "通知中心",
    "nav.profile": "个人中心",
    "nav.tools": "工具",
    "nav.tasks": "任务监控",
    "nav.recyclebin": "回收站",
    "nav.guides": "指导文档",
    "nav.system": "系统",
    
    // login
    "login.title": "登录",
    "login.username": "用户名",
    "login.password": "密码",
    "login.submit": "登录",
    "login.forgotPassword": "忘记密码？",
    "login.dingtalkLogin": "钉钉扫码登录",
    
    // dashboard
    "dashboard.title": "首页",
    "dashboard.totalProducts": "产品总数",
    "dashboard.activeStores": "在线店铺数",
    "dashboard.todayPushes": "今日推送任务",
    "dashboard.pendingApprovals": "待办审批",
    "dashboard.recentFailedTasks": "最近失败任务",
    "dashboard.notificationsLast24h": "24 小时通知发送",
  },
  "en-US": {
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.confirm": "Confirm",
    "common.loading": "Loading…",
    "common.empty": "No data",
    
    "nav.home": "Home",
    "nav.business": "Business",
    "nav.products": "Products",
    "nav.stores": "Stores",
    "nav.partner-stores": "Partner Stores",
    "nav.newstore": "New Store",
    "nav.assets": "Assets",
    "nav.snapshots": "Product Snapshots",
    "nav.assets-snapshot": "Theme Assets",
    "nav.templates": "Templates",
    "nav.flow": "Workflow",
    "nav.approvals": "Approvals",
    "nav.invitations": "Invitations",
    "nav.cross-auth": "Cross-Company Auth",
    "nav.my": "My",
    "nav.inbox": "Inbox",
    "nav.profile": "Profile",
    "nav.tools": "Tools",
    "nav.tasks": "Tasks",
    "nav.recyclebin": "Recycle Bin",
    "nav.guides": "Guides",
    "nav.system": "System",
    
    "login.title": "Sign In",
    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Sign In",
    "login.forgotPassword": "Forgot password?",
    "login.dingtalkLogin": "DingTalk QR",
    
    "dashboard.title": "Dashboard",
    "dashboard.totalProducts": "Total Products",
    "dashboard.activeStores": "Active Stores",
    "dashboard.todayPushes": "Pushes Today",
    "dashboard.pendingApprovals": "Pending Approvals",
    "dashboard.recentFailedTasks": "Recent Failed Tasks",
    "dashboard.notificationsLast24h": "Notifications (24h)",
  },
} as const;

export type Locale = "zh-CN" | "en-US";
export type MessageKey = keyof typeof messages["zh-CN"];
```

**新建** `frontend-admin/lib/i18n/context.tsx`：

```tsx
"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { messages, type Locale, type MessageKey } from "./messages";

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, fallback?: string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh-CN");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("locale") as Locale | null;
      if (saved === "zh-CN" || saved === "en-US") setLocaleState(saved);
    } catch {}
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    try { localStorage.setItem("locale", l); } catch {}
  }

  function t(key: MessageKey, fallback?: string): string {
    const dict = messages[locale];
    return (dict as Record<string, string>)[key] ?? fallback ?? key;
  }

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // fallback for components rendered outside provider (e.g., tests)
    return {
      locale: "zh-CN" as Locale,
      setLocale: () => {},
      t: (key: MessageKey, fallback?: string) =>
        (messages["zh-CN"] as Record<string, string>)[key] ?? fallback ?? key,
    };
  }
  return ctx;
}
```

### 3.2 注入 Provider 到 (authed)/layout.tsx

先 Read。在已有的 `<QueryClientProvider>` 内层包 `<I18nProvider>`：
```tsx
<QueryClientProvider client={queryClient}>
  <I18nProvider>
    {children}
  </I18nProvider>
</QueryClientProvider>
```

注：login 页（非 authed）也想要 i18n → 把 I18nProvider 加到 `app/layout.tsx` 根层（更通用）。先 Read 看 root layout 决定：

如 root layout 是 RSC（无 "use client"），加 I18nProvider 需把它放在 client component 子层。可以新建 `components/Providers.tsx` 客户端 wrapper，root layout 内 import 之包 children。

简化：
- 把 I18nProvider 加到 `app/(authed)/layout.tsx`（已是 client，已有 QueryClientProvider）
- login 不加 i18n（v1 接受），文案保持中文 — 报告里说明 v2 推到 root

### 3.3 lang switcher button

**修改** `frontend-admin/components/layout/AppShell.tsx`

在 header 区 🔔 + ☀️/🌙 旁加 lang switcher：

```tsx
const { locale, setLocale, t } = useI18n();
...
<button
  onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
  className="rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent"
  aria-label="切换语言 / Switch language"
>
  {locale === "zh-CN" ? "EN" : "中"}
</button>
```

NAV_GROUPS 内的 label 改用 t():
```ts
{ section: t("nav.business"), items: [
  { href: "/products", label: t("nav.products") },
  ...
]}
```

注意：NAV_GROUPS 是模块顶部 const，不能直接调 hook。改成：
- 把 NAV_GROUPS 改成函数 `function getNavGroups(t: (k: MessageKey) => string)` 在组件内调用
- 或在 NavList 组件内根据 t 动态渲染

### 3.4 dashboard 文案 i18n
**修改** `frontend-admin/app/(authed)/dashboard/page.tsx`

- import useI18n
- 4 卡片 CardDescription 改 `{t("dashboard.totalProducts")}` 等
- 「最近失败任务」section title 改 t("dashboard.recentFailedTasks")
- 24h 通知 section title 改 t("dashboard.notificationsLast24h")

### 3.5 login 选填
**修改** `frontend-admin/app/login/page.tsx`

login 在 (authed) 之外，无 I18nProvider。**简化方案**：
- login 文案保持中文；不动该文件
- 报告说明 v2 推 I18nProvider 到 root 后做

### 3.6 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T26/T28/T29 范围
- 其他文件

### 输出
1. lib/i18n/ 文件清单 + messages 数量
2. AppShell lang switcher 实现（位置 + 切换效果）
3. NAV 改造前后对比（label 是否全部 t() 化）
4. dashboard t() 化覆盖
5. login 是否做 i18n（v1 还是 v2）
6. tsc 结果

---

## 4. T28 详细任务（后端关键 controller 测试）

### 4.1 ApprovalEngine + ApprovalController 测试

**新建** `backend-api/src/test/java/com/biou/shopifyhub/approval/ApprovalEngineTest.java`

`@SpringBootTest @ActiveProfiles("test") @Transactional`（每 test 自动回滚）

测试项：
1. `submit_PRODUCT_ACCESS_OK` — 提交 → 状态 PENDING + log SUBMIT 1 行
2. `approve_OK` — submit → approve → 状态 APPROVED + log SUBMIT/APPROVE 2 行 + decidedBy 设
3. `reject_then_resubmit_OK` — reject → REJECTED → resubmit → PENDING + decidedBy 重置
4. `cancel_OK` — submit → cancel → CANCELLED
5. `approve_by_role_OK` — 角色任一签批模式 → 该角色用户 approve OK；非该角色用户 approve 抛 BusinessException
6. `cross_company_auth_hook` — submit CROSS_COMPANY_AUTH approve → 触发 sys_data_scope 写入

**新建** `backend-api/src/test/java/com/biou/shopifyhub/approval/ApprovalControllerTest.java`

用 `@SpringBootTest @AutoConfigureMockMvc`：
- POST /approval — 200
- GET /approval/{id} — 200 + 含 logs
- POST /approval/{id}/approve — 200
- POST /approval/batch/approve — 200 + ok/fail count

### 4.2 InappService 测试

**新建** `backend-api/src/test/java/com/biou/shopifyhub/notification/inapp/InappServiceTest.java`

`@SpringBootTest @Transactional`：
1. `send_creates_inapp_message` — InappService.send(...) → DB 行存在
2. `markRead_only_owner` — markRead(userId, messageId) — 用户不匹配时不生效（幂等）
3. `unreadCount_excludes_read` — send 3 个 + markRead 1 个 → unreadCount=2

### 4.3 测试配置

如 `backend-api/src/test/resources/application-test.yml` 不存在，新建：
- 使用 H2 in-memory 数据库（避免依赖外部 mysql）
  - 或：用 `@SpringBootTest` 默认 + Testcontainers MySQL（更慢但更真实）
- Flyway 启用，跑 V1..V25 全部
- Redis: embedded 或 mock（如有 redisson-mock 或简化为 disable redis-bound 的 service）
- RabbitMQ: 简化 disable（用 `@MockBean` 替换 RabbitTemplate）

简化策略：用 H2 + Flyway H2 模式（注：Flyway SQL 含 mysql 特定语法如 ENUM、JSON、AUTO_INCREMENT；可能不兼容）

**Fallback**：如 Flyway H2 不兼容 → 用 Testcontainers `@DynamicPropertySource` 起 mysql:8 容器（需要 docker；CI 环境通常有）。**先尝试 H2**，不行用 Testcontainers，再不行手动 SQL setup。

### 4.4 跑测试

```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH mvn test -Dtest='ApprovalEngineTest,ApprovalControllerTest,InappServiceTest'
```

如 H2 / Testcontainers 配置失败，**报告配置失败 + 测试已写但 mvn test 跳过该 step**；不要 break 主 mvn compile。

### 不要碰
- T26/T27/T29 范围
- src/main/java/

### 输出
1. 3 个 test 文件 + 测试用例数
2. 测试配置（H2 / Testcontainers / 其他）
3. mvn test 跑结果（如失败说明原因）
4. backend mvn compile（不带 test）必须仍 SUCCESS

---

## 5. T29 详细任务（Playwright e2e）

### 5.1 装包 + 配置

```
cd frontend-admin && pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

**新建** `frontend-admin/playwright.config.ts`：

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.CI ? undefined : {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

### 5.2 3 spec 文件

**新建** `frontend-admin/e2e/login.spec.ts`：

```ts
import { test, expect } from "@playwright/test";

test("login with admin/admin123", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("login fails with bad password shows error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button", { name: "登录" }).click();
  // 验证 toast 或 error message
  await expect(page.getByText(/密码错误|认证失败|用户名或密码/i)).toBeVisible({ timeout: 5000 });
});
```

**新建** `frontend-admin/e2e/products.spec.ts`：

```ts
test("products list loads + search works", async ({ page }) => {
  // 先登录（用 fixture / helper）
  await loginAsAdmin(page);
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: /产品库|Products/i })).toBeVisible();
  // 搜索
  const search = page.getByPlaceholder(/搜索|Search/i);
  if (await search.isVisible()) {
    await search.fill("test");
    await page.waitForTimeout(500);
  }
  // 至少表头/列表区域可见
  await expect(page.locator("text=Handle|handle").first()).toBeVisible({ timeout: 5000 });
});
```

**新建** `frontend-admin/e2e/approval.spec.ts`：

```ts
test("approval submit + view detail", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: /审批/i })).toBeVisible();
  // 可点开任一现有审批进入详情（不真创建以避免脏数据）
});
```

**helper** `frontend-admin/e2e/helpers/auth.ts`：

```ts
import type { Page } from "@playwright/test";

export async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/用户名|username/i).fill("admin");
  await page.getByLabel(/密码|password/i).fill("admin123");
  await page.getByRole("button", { name: /登录|sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
}
```

### 5.3 package.json scripts

加：
```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:debug": "PWDEBUG=1 playwright test"
```

### 5.4 .gitignore 加 Playwright

```
# Playwright
test-results/
playwright-report/
playwright/.cache/
e2e/__trash/
```

### 5.5 ci.yml 加 playwright job（**与 T24 e2e-wave4 共存**）

```yaml
  e2e-frontend:
    name: E2E Frontend (Playwright)
    needs: [frontend, backend]
    runs-on: ubuntu-latest
    continue-on-error: true
    services:
      mysql:  # 同 T24 服务定义
        ...
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: cd frontend-admin && pnpm install
      - run: cd frontend-admin && pnpm exec playwright install --with-deps chromium
      # 启 backend + frontend → run playwright
      - name: Build & start backend
        run: |
          # 同 T24 启动逻辑
      - name: Build & start frontend
        run: |
          cd frontend-admin
          pnpm build
          nohup pnpm start > /tmp/frontend.log 2>&1 &
          for i in {1..30}; do curl -fsS http://localhost:3000 && break; sleep 2; done
      - name: Run Playwright
        run: cd frontend-admin && pnpm test:e2e
        env:
          CI: true
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: frontend-admin/playwright-report/
          retention-days: 7
```

如 ci 启动复杂度太高，**降级**：仅本地 npm script + README 加跑法，不进 CI（因为需要 backend + frontend 都启动 + DB seed，CI 配置工作量大）。

### 5.6 typecheck（含 e2e/ 文件夹）

```
cd frontend-admin && pnpm tsc --noEmit
```

如果 tsconfig.json `include` 不含 e2e/，需要加；或为 e2e/ 单独建 tsconfig.json extends 主 + override include。

### 不要碰
- T26/T27/T28 范围
- backend
- 其他前端 page

### 输出
1. playwright.config.ts + 3 spec + helpers/auth.ts 清单
2. package.json 新增 script
3. ci.yml 是否加 job（或 fallback 本地跑）
4. 是否真在本地跑过 1 次（如 backend/frontend 都没起，记录 expected fail + skip 实际跑）

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
