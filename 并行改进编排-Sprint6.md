# 并行改进编排（Sprint 6）

> 编排：2026-05-03
> 用途：后端补 4 endpoint + TanStack Query 扩展到 3 高频列表 + CI/CD 加固 + 多数据源 admin UI。
> 文件冲突边界：T23 owns AppShell bell；T25 不动 AppShell；T22+T23 各自 lib/api 区域不重叠。

---

## 0. Track 划分

| Track | 内容 | 工时 | 主要文件 |
|---|---|---|---|
| **T22** | 后端 4 个 endpoint：asset cancel / store test 真调 Shopify / approval batch / task events SSE | ~3 PD | 4 个后端 controller + 前端 lib/api/* method |
| **T23** | TanStack Query 扩展到 products + tasks + stores 列表 + AppShell bell 迁移 | ~3 PD | lib/queries/products.ts/tasks.ts/stores.ts + 3 page.tsx + AppShell.tsx |
| **T24** | CI/CD 加固：e2e-wave4 进 ci.yml + pre-commit hook + 测试覆盖率门槛 | ~2 PD | .github/workflows/ci.yml + .husky/ or .githooks/ + Maven surefire config |
| **T25** | 前端 /admin/datasources 多数据源管理 UI | ~1.5 PD | app/(authed)/admin/datasources/page.tsx + lib/api/datasource.ts |

**总工时**：~9.5 PD（4 人并行约 1 周）

---

## 1. 文件 Ownership

| 文件 | Owner |
|---|---|
| `backend-api/.../asset/AssetSnapshotController.java` | T22（加 cancel） |
| `backend-api/.../store/StoreController.java` | T22（test 真调 Shopify） |
| `backend-api/.../approval/ApprovalController.java` | T22（batch approve） |
| `backend-api/.../push/TaskController.java` | T22（events SSE） |
| `frontend-admin/lib/api/asset.ts / store.ts / approval.ts / task.ts` | T22 |
| `frontend-admin/lib/queries/*.ts` | T23（新建文件夹） |
| `frontend-admin/app/(authed)/products/page.tsx` | T23（迁 useQuery） |
| `frontend-admin/app/(authed)/tasks/page.tsx` | T23（迁 useQuery + 保留 T9/T19 现有逻辑） |
| `frontend-admin/app/(authed)/stores/page.tsx` | T23（迁 useQuery） |
| `frontend-admin/components/layout/AppShell.tsx` | T23（bell 用 useQuery 替换 setInterval） |
| `.github/workflows/ci.yml` | T24 |
| `.husky/` 或 `.githooks/` | T24 |
| `frontend-admin/app/(authed)/admin/datasources/page.tsx` | T25 |
| `frontend-admin/lib/api/datasource.ts` | T25 |

T25 加菜单时**不要**改 AppShell（T23 owner）；T25 prompt 里说明菜单加在「系统」组，让我在合并时统一加。

---

## 2. T22 详细任务（后端补 4 endpoint）

### 2.1 POST /asset-snapshot/{id}/cancel
**修改** `AssetSnapshotController.java`

```java
@PostMapping("/{id}/cancel")
public Result<Void> cancel(@PathVariable Long id) {
    AssetSnapshot s = mustGet(id);
    if (!"PENDING".equals(s.getStatus()) && !"RUNNING".equals(s.getStatus())) {
        throw new BusinessException(ResultCode.CONFLICT, "仅 PENDING/RUNNING 可取消");
    }
    s.setStatus("CANCELED");
    snapshotMapper.updateById(s);
    return Result.ok();
}
```

实际枚举以 V8 SQL 为准（grep `asset_snapshot` 表 status enum）。

### 2.2 GET /store/{id}/test 真调 Shopify shop.json

**修改** `StoreController.java#test`

把 T10 简化版改成真调：
```java
@GetMapping("/{id}/test")
public Result<Map<String, Object>> test(@PathVariable Long id) {
    Store s = service.getById(id);
    Map<String, Object> r = new LinkedHashMap<>();
    r.put("storeId", id);
    r.put("status", s.getStatus());
    r.put("tokenPresent", s.getEncryptedToken() != null);
    if (!"ACTIVE".equals(s.getStatus())) {
        r.put("healthy", false);
        r.put("reason", "store status=" + s.getStatus());
        return Result.ok(r);
    }
    try {
        // 真调 GET https://{shop}/admin/api/2024-10/shop.json
        // 用现有 shopifyAdmin client（grep find）；如无 client 类，用 HttpClient
        Map<String, Object> shopJson = shopifyClient.getShopInfo(s);  // 假设方法存在
        r.put("healthy", true);
        r.put("shopName", shopJson.get("name"));
        r.put("planName", shopJson.get("plan_name"));
    } catch (Exception e) {
        r.put("healthy", false);
        r.put("reason", e.getMessage());
    }
    return Result.ok(r);
}
```

如无 ShopifyAdminClient 类，用 `HttpClient.newHttpClient()` 直接调（带 `X-Shopify-Access-Token: <decrypted_token>` header）；token 用 `AesGcmUtil.decrypt(s.getEncryptedToken(), key)`。

如完整实现复杂度高，**fallback** 为调用 worker 端点 `/test/store?shop_domain=...`（如 worker 有），或保留 T10 简化版 + log warn「真调待 Shopify SDK 完整化」。

### 2.3 POST /approval/batch — 批量审批通过
**修改** `ApprovalController.java`

加：
```java
@PostMapping("/batch/approve")
public Result<Map<String, Object>> batchApprove(@RequestBody BatchApproveBody body) {
    Long me = CurrentUser.userIdOrThrow();
    int ok = 0, fail = 0;
    List<Long> failedIds = new ArrayList<>();
    for (Long id : body.flowIds()) {
        try {
            engine.approve(id, me, body.comment());
            ok++;
        } catch (Exception e) {
            fail++;
            failedIds.add(id);
        }
    }
    return Result.ok(Map.of("ok", ok, "fail", fail, "failedIds", failedIds));
}

public record BatchApproveBody(List<Long> flowIds, String comment) {}
```

### 2.4 GET /task/{id}/events SSE

**修改** `TaskController.java`

加 SSE：
```java
@GetMapping(value = "/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter events(@PathVariable Long id) {
    SseEmitter emitter = new SseEmitter(60_000L * 30);  // 30min
    // 简化版：每 2s poll DB 一次，发当前 status；status 终态后 complete
    Thread t = new Thread(() -> {
        try {
            String last = null;
            while (true) {
                Task task = taskMapper.selectById(id);
                if (task == null) { emitter.complete(); return; }
                String cur = task.getStatus() + "|" + task.getProgress();
                if (!cur.equals(last)) {
                    Map<String, Object> data = Map.of(
                        "status", task.getStatus(),
                        "progress", task.getProgress() == null ? 0 : task.getProgress(),
                        "errorMessage", task.getErrorMessage()
                    );
                    emitter.send(SseEmitter.event().name("task").data(data));
                    last = cur;
                }
                if ("SUCCESS".equals(task.getStatus()) || "FAILED".equals(task.getStatus())
                    || "CANCELED".equals(task.getStatus()) || "PARTIAL".equals(task.getStatus())) {
                    emitter.complete();
                    return;
                }
                Thread.sleep(2000);
            }
        } catch (Exception e) {
            emitter.completeWithError(e);
        }
    }, "sse-task-" + id);
    t.setDaemon(true);
    t.start();
    return emitter;
}
```

参考已有 `AssetProgressController.java` 的 SSE 实现（如有）。

### 2.5 前端：lib/api/* 加 method

- `asset.ts` 加 `cancel(id)`
- `store.ts` 加 `test(id)`（实际 T9 + T10 已有 healthCheck，确认调真 endpoint）
- `approval.ts` 加 `batchApprove(flowIds, comment?)`
- `task.ts` 加 `eventsUrl(id)`：返回 `/api/task/{id}/events`（前端 EventSource 用）

### 2.6 编译
```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH mvn -DskipTests compile
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T23 / T24 / T25 范围
- 其他 controller / page

### 输出
1. 4 endpoint URL + 简述
2. compile + tsc 结果
3. 已有 ShopifyClient 是否存在（决定 store/test 实现深度）
4. AssetSnapshot CANCELED 枚举确认

---

## 3. T23 详细任务（TanStack Query 扩展）

### 3.1 创建 query hooks

**新建** `frontend-admin/lib/queries/products.ts`：
```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { productApi } from "@/lib/api/product";

export function useProducts(params: { page: number; size: number; status?: string; q?: string }) {
  return useQuery({
    queryKey: ["products", params],
    queryFn: () => productApi.list(params.page, params.size, { status: params.status, q: params.q }),
  });
}
export function useInvalidateProducts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["products"] });
}
```

**新建** `frontend-admin/lib/queries/tasks.ts`：
```ts
export function useTasks(params: { page: number; size: number; type?: string; status?: string; storeId?: number; parentTaskId?: number }) {
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: () => taskApi.list(params.page, params.size, { type: params.type, status: params.status, storeId: params.storeId, parentTaskId: params.parentTaskId }),
    refetchInterval: false,  // 由组件自己控制 (T9 自动刷新 toggle)
  });
}
export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["tasks"] });
}
```

**新建** `frontend-admin/lib/queries/stores.ts`：
```ts
export function useStores(params?: { status?: string }) {
  return useQuery({
    queryKey: ["stores", params],
    queryFn: () => storeApi.list(),
  });
}
export function useInvalidateStores() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["stores"] });
}
```

**新建** `frontend-admin/lib/queries/inbox.ts`：
```ts
export function useUnreadInboxCount() {
  return useQuery({
    queryKey: ["inbox", "unread-count"],
    queryFn: () => inboxApi.unreadCount(),
    refetchInterval: 30_000,  // 替代 setInterval
  });
}
```

### 3.2 迁移 products 列表
**修改** `frontend-admin/app/(authed)/products/page.tsx`

- import `useProducts` + `useInvalidateProducts`
- 删 `useState<List>` + `useEffect` fetch + `loading` state
- 改用 `const { data, isPending, error } = useProducts({ page, size, status, q });`
- 列表 `data?.records ?? []`；total `data?.total ?? 0`
- mutation（删除 / 批量上下架）后调 `invalidateProducts()`

**保留** T20/T21 的 a11y + virtualizer 逻辑。

### 3.3 迁移 tasks 列表
**修改** `frontend-admin/app/(authed)/tasks/page.tsx`

- import `useTasks` + `useInvalidateTasks`
- 删 `useState<TaskList>` + `useEffect` fetch
- 改用 `useTasks({...})`
- T9 的「自动刷新 30s toggle」改为 `refetchInterval: autoRefresh ? 30_000 : false`（用 query options 动态切换）
- T19 的 cancel + retry mutation 后调 `invalidateTasks()`
- 子任务展开（T9）也用 useQuery (key: ["tasks", "children", id])

**保留** 父子任务展开 / 重试 / 取消 / 自动刷新 toggle / aria-label 全部既有功能。

### 3.4 迁移 stores 列表
**修改** `frontend-admin/app/(authed)/stores/page.tsx`

- 删 useEffect fetch
- 改用 `useStores()`
- 健康检查 / disable / 批量操作 后 `invalidateStores()`

### 3.5 AppShell bell 迁到 useQuery
**修改** `frontend-admin/components/layout/AppShell.tsx`

- 删原 `useState<number>(unread)` + `useEffect setInterval(tick, 30_000)`
- 改用 `const { data: unreadResp } = useUnreadInboxCount(); const unread = unreadResp?.count ?? 0;`
- bell badge 渲染逻辑不变

### 3.6 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T22 (lib/api/* 方法添加)
- T24 (CI 配置)
- T25 (admin/datasources)
- 其他页面 / 后端

### 输出
1. 4 个 query hooks 清单
2. 3 个 page + AppShell 迁移概述（删了多少行 useEffect）
3. tsc 结果

---

## 4. T24 详细任务（CI/CD 加固）

### 4.1 .github/workflows/ci.yml 加 e2e-wave4 job

先 Read 现有 ci.yml。

在 4 个并行 job 后追加（依赖前 4 job）：
```yaml
e2e-wave4:
  needs: [frontend, backend, worker]
  runs-on: ubuntu-latest
  services:
    mysql:
      image: mysql:8.0
      env:
        MYSQL_ROOT_PASSWORD: root
        MYSQL_DATABASE: shopifyhub
      ports: ['3307:3306']
      options: --health-cmd="mysqladmin ping" ...
    redis:
      image: redis:8.0
      ports: ['6380:6379']
  steps:
    - uses: actions/checkout@v4
    - name: Setup Java 21
      uses: actions/setup-java@v4
      with: { distribution: 'temurin', java-version: '21' }
    - name: Build backend
      run: cd backend-api && mvn -DskipTests package
    - name: Run backend
      run: |
        cd backend-api && nohup mvn spring-boot:run > /tmp/backend.log 2>&1 &
        for i in {1..60}; do curl -fsS http://localhost:8080/api/health && break; sleep 2; done
    - name: Run e2e-wave4
      run: bash bin/e2e-wave4.sh
    - name: Backend log on failure
      if: failure()
      run: tail -200 /tmp/backend.log
```

如 ci.yml 没有现有 worker / backend job 名，按实际命名调整 needs。

### 4.2 pre-commit hook

**新建** `.githooks/pre-commit`（user 需手动 `git config core.hooksPath .githooks` 启用）：
```bash
#!/usr/bin/env bash
# 1. 不允许提交 .env / 配置信息.md / 密钥
git diff --cached --name-only | grep -qE '^(\.env|配置信息\.md|.*\.key|.*\.pem)$' && {
    echo "❌ 禁止提交: .env / 配置信息.md / *.key / *.pem"
    exit 1
}

# 2. 简单 secret scan (不依赖 gitleaks)
git diff --cached -U0 | grep -E '(shpss_[a-f0-9]{20,}|atE[a-zA-Z0-9_-]{30,}|sk_live_)' && {
    echo "❌ 检测到疑似 secret"
    exit 1
}

# 3. typescript 增量 check (仅前端文件改动时跑)
if git diff --cached --name-only | grep -qE '^frontend-admin/.*\.(ts|tsx)$'; then
    cd frontend-admin && pnpm tsc --noEmit || {
        echo "❌ frontend tsc 失败"
        exit 1
    }
fi

# 4. java 增量 compile (改动时)
if git diff --cached --name-only | grep -qE '^backend-api/.*\.java$'; then
    cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 mvn -q -DskipTests compile || {
        echo "❌ backend mvn compile 失败"
        exit 1
    }
fi

echo "✅ pre-commit 通过"
```

chmod +x。

### 4.3 README 加引用

README 「开发约定」section 加：
```
- pre-commit hook：`git config core.hooksPath .githooks` 启用
```

### 不要碰
- 后端 / 前端 page
- T22/T23/T25 范围

### 输出
1. ci.yml e2e-wave4 job 配置概述
2. pre-commit hook 检查项清单
3. README 改动

---

## 5. T25 详细任务（/admin/datasources 多数据源管理）

### 5.1 API client
**新建** `frontend-admin/lib/api/datasource.ts`：

```ts
import { api } from "./client";

export type TenantDataSource = {
  id?: number;
  tenantId: number;
  tenantCode: string;
  url: string;
  username: string;
  poolMin?: number;
  poolMax?: number;
  status: "ACTIVE" | "DISABLED";
  createdAt?: string;
};

export const datasourceApi = {
  list: () => api.get<TenantDataSource[]>(`/admin/tenant/datasource`),
  reload: () => api.post<{ message: string }>(`/admin/tenant/datasource/reload`),
  register: (tenantId: number, body: Partial<TenantDataSource>) =>
    api.post<void>(`/admin/tenant/datasource/${tenantId}/register`, body),
  remove: (key: string) => api.del<void>(`/admin/tenant/datasource/${key}`),
};
```

确认实际后端 controller 字段（先 Read `TenantDataSourceController.java`）。

### 5.2 页面 `frontend-admin/app/(authed)/admin/datasources/page.tsx`

UI:
- 顶部标题 + 「Reload 路由」按钮（调 reload）+ 「+ 注册新租户」按钮
- 表格列：tenantCode / tenantId / url（脱敏：mysql://**:**@host:port/db）/ status badge / poolMax / 操作（删除）
- 「+ 注册新租户」弹 Dialog：tenantId / tenantCode / url / username / password / poolMin / poolMax 表单
  - 用 Sprint 3 的 `<Form>` `<FormField>`
- 删除：`window.confirm("确认删除数据源 ${key}？")` → `datasourceApi.remove(key)` → 刷新
- loading / empty / error 用 StatusBlocks

如端点未实现某个方法（如 register 的 body 格式不对），先调一次看 response，按实际调整。

### 5.3 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```

### 5.4 NAV 菜单
**不要修改 AppShell.tsx**（T23 owner）。在输出报告里说明：

> 我（编排者）合并时会在 AppShell.tsx 「系统」组加 `{ href: "/admin/datasources", label: "数据源" }`。

### 不要碰
- 后端任何文件
- T22/T23/T24 范围
- 其他页面
- AppShell.tsx

### 输出
1. 修改/创建文件清单
2. tsc 结果
3. NAV 菜单建议项给我合并

---

## 6. 启动检查表

每 track 完工时输出：
1. 创建/修改文件清单
2. compile / tsc 结果
3. 已知 fallback / TODO

合并后我做：
- backend mvn compile + frontend tsc 全量验证
- AppShell.tsx 加 /admin/datasources 菜单（统一）
- git commit + push

---

_最后更新：2026-05-03_
