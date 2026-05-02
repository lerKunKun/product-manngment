# 并行改进编排（Sprint 5）

> 编排：2026-05-03（Sprint 1-4 后）
> 用途：E2E 自动化 + 后端 cancel/export endpoint + Stepper 抽取 + a11y 加固 + products 虚拟滚动。
> 文件冲突边界：明确按文件 ownership 切分，4 track 互不重叠。

---

## 0. Track 划分

| Track | 内容 | 工时 | 主要文件 |
|---|---|---|---|
| **T18** | E2E 自动化脚本 bin/e2e-wave4.sh | ~3 PD | bin/e2e-wave4.sh + ops/release 同步 |
| **T19** | 后端 task cancel + audit-log CSV export endpoint + 前端 wire | ~2.5 PD | TaskController + SysAuditLogController + tasks page + audit-log page |
| **T20** | Stepper 组件抽取 + a11y aria-label 批量加固 | ~1.5 PD | components/ui/Stepper.tsx + newstore page + 5 个页面 a11y |
| **T21** | products 列表虚拟滚动 (@tanstack/react-virtual) | ~1.5 PD | products/page.tsx + package.json |

**总工时**：~8.5 PD（4 人并行约 1 周）

---

## 1. 文件 Ownership

| 文件 | Owner |
|---|---|
| `bin/e2e-wave4.sh` | T18 |
| `bin/lib/curl-wave4.sh`（如需 helper） | T18 |
| `backend-api/.../push/TaskController.java` | T19（加 cancel） |
| `backend-api/.../audit/SysAuditLogController.java` | T19（加 export） |
| `frontend-admin/lib/api/task.ts` | T19 |
| `frontend-admin/lib/api/auditLog.ts` | T19 |
| `frontend-admin/app/(authed)/tasks/page.tsx` | T19（加 cancel 按钮） |
| `frontend-admin/app/(authed)/admin/audit-log/page.tsx` | T19（接 export endpoint，替代当前前端拼 CSV 逻辑） |
| `frontend-admin/components/ui/Stepper.tsx`（新建） | T20 |
| `frontend-admin/app/(authed)/newstore/[taskId]/page.tsx` | T20（用新 Stepper） |
| 5 个 page.tsx 的 a11y aria-label | T20 |
| `frontend-admin/app/(authed)/products/page.tsx` | T21 |
| `frontend-admin/package.json` | T21（add @tanstack/react-virtual） |

**T19 与 T17/T19 之前的 admin/audit-log 改造**：T19 替换前端 CSV 拼接逻辑（改为下载后端 streaming）；T17 已加 DateRangePicker + Card，T19 不动这些。

**T20 与 T19 在 newstore + tasks**：T20 不动 tasks（T19 owns）；T20 只动 newstore 与 a11y 散点。

---

## 2. T18 详细任务（E2E 自动化脚本）

### 2.1 bin/e2e-wave4.sh

参考 `bin/e2e-saga.sh` 风格（已有 18/18 步骤）。

新建 `/Users/zhangxueqian/development/product-manngment/bin/e2e-wave4.sh`：

```bash
#!/usr/bin/env bash
# Wave 4 全功能 e2e 验收脚本（W4-RLS-03 自动化版）
# 对应《ops/release/wave4-regression-e2e.md》§3 G1-G5 e2e
set -euo pipefail
cd "$(dirname "$0")/.."

API="${API:-http://localhost:8080/api}"
PASS=0; FAIL=0; STEPS=()

step() {
    local name="$1"; shift
    if "$@" >/tmp/wave4-out 2>&1; then
        PASS=$((PASS+1)); STEPS+=("✅ $name"); echo "✅ $name"
    else
        FAIL=$((FAIL+1)); STEPS+=("❌ $name"); echo "❌ $name"
        echo "--- output ---"; cat /tmp/wave4-out; echo "---"
    fi
}

# 0. 登录拿 JWT
echo "## 0. 登录"
TOKEN=$(curl -s -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin123"}' | jq -r '.data.accessToken')
test -n "$TOKEN" && test "$TOKEN" != "null" || { echo "登录失败"; exit 1; }
AUTH="-H Authorization: Bearer $TOKEN"

# 1. Flyway V21..V24 迁移成功
step "Flyway V21 approval_flow" \
    bash -c "mysql -h 127.0.0.1 -P 3307 -u shopifyhub -p\$MYSQL_PASSWORD -N -e 'SELECT 1 FROM information_schema.tables WHERE table_name=\"approval_flow\"' shopifyhub | grep -q 1"
# 同样 V22 V23 V24 各表

# 2. G1 审批中心 e2e
echo "## 2. G1 审批中心"
FLOW=$(curl -s -X POST "$API/approval" $AUTH \
    -H 'Content-Type: application/json' \
    -d '{"type":"PRODUCT_ACCESS","payload":{"productId":1,"reason":"e2e test"},"approverId":1}' \
    | jq -r '.data.id')
step "提交审批 #$FLOW" test -n "$FLOW" -a "$FLOW" != "null"
step "查待办列表含 $FLOW" \
    bash -c "curl -s '$API/approval/pending/me' $AUTH | jq -e '.data[] | select(.id == $FLOW)' >/dev/null"
step "通过审批 #$FLOW" \
    bash -c "curl -s -X POST '$API/approval/$FLOW/approve' $AUTH -H 'Content-Type: application/json' -d '{\"comment\":\"OK\"}' | jq -e '.data.status == \"APPROVED\"' >/dev/null"

# 3. G2 通知订阅
echo "## 3. G2 通知订阅"
step "事件列表 ≥ 16" \
    bash -c "curl -s '$API/notification/events' $AUTH | jq -e '[.data[] | length] | add >= 16' >/dev/null"
step "我的订阅" \
    bash -c "curl -s '$API/notification/subscriptions/me' $AUTH | jq -e '. | length >= 0' >/dev/null"

# 4. G3 密码重置
echo "## 4. G3 密码重置"
step "密码重置请求" \
    bash -c "curl -s -X POST '$API/auth/password-reset/request' -H 'Content-Type: application/json' -d '{\"email\":\"admin@example.com\"}' | jq -e '.code == 0' >/dev/null"

# 5. G4 审计归档手动触发（仅检查端点可达）
echo "## 5. G4 审计归档"
step "audit-archive list" \
    bash -c "curl -s '$API/admin/audit-archive' $AUTH | jq -e '.code == 0' >/dev/null"
step "backup-status" \
    bash -c "curl -s '$API/admin/ops/backup-status' $AUTH | jq -e '.code == 0' >/dev/null"

# 6. G5 监控规则加载
echo "## 6. G5 监控规则"
step "Prometheus rules 含 ops-alerts" \
    bash -c "curl -s http://localhost:9090/api/v1/rules 2>/dev/null | jq -e '.data.groups[].name | select(. == \"ops-alerts\")' >/dev/null || echo 'prometheus 未启动，跳过'"

# 7. 后端 metric 暴露
echo "## 7. Metrics"
step "/actuator/prometheus 含 shopifyhub_notification_send_total" \
    bash -c "curl -s '$API/actuator/prometheus' | grep -q shopifyhub_notification_send_total"
step "/actuator/prometheus 含 shopifyhub_r2_upload_total" \
    bash -c "curl -s '$API/actuator/prometheus' | grep -q shopifyhub_r2_upload_total"
step "/actuator/prometheus 含 shopifyhub_approval_pending_max_age_seconds" \
    bash -c "curl -s '$API/actuator/prometheus' | grep -q shopifyhub_approval_pending_max_age_seconds"

# 收尾
echo
echo "===================="
echo "Wave 4 e2e: $PASS pass / $FAIL fail"
test $FAIL -eq 0
```

注意：
- 兼容 Wave 4 实际部署（dev 环境 mysql 端口 3307）
- 所有 step 用 `step "name" command...` 包装统一格式
- 任意 step 失败立即停（`set -e`）
- 退出码非 0 = 验收失败

### 2.2 chmod +x + 在 README 加引用

更新 `README.md` 「快速开始 → 端到端冒烟」section，加：
```
./bin/e2e-wave4.sh           # Wave 4 全功能 ~12 步
```

### 不要碰
- 任何后端 / 前端 page

### 输出
1. bin/e2e-wave4.sh 步骤数 + 覆盖范围
2. 是否能在当前 dev 环境跑通（如 backend 未启动、mysql 未起则跳过部分步骤但不报错）
3. README 改动

---

## 3. T19 详细任务（task cancel + audit-log export + 前端 wire）

### 3.1 后端：TaskController 加 cancel
**修改** `backend-api/src/main/java/com/biou/shopifyhub/push/TaskController.java`

加：
```java
@PostMapping("/{id}/cancel")
public Result<Void> cancel(@PathVariable Long id) {
    Task t = mustGet(id);
    if (!"PENDING".equals(t.getStatus()) && !"RUNNING".equals(t.getStatus())) {
        throw new BusinessException(ResultCode.CONFLICT, "仅 PENDING/RUNNING 任务可取消");
    }
    t.setStatus("CANCELED");
    taskMapper.updateById(t);
    return Result.ok();
}
```
（Task 实际字段名 grep 确认；status 枚举 CANCELED 与现有对齐）

### 3.2 后端：SysAuditLogController 加 export streaming
**修改** `backend-api/src/main/java/com/biou/shopifyhub/audit/SysAuditLogController.java`

加：
```java
@GetMapping("/export")
public ResponseEntity<StreamingResponseBody> export(
    @RequestParam(required = false) Long userId,
    @RequestParam(required = false) String module,
    @RequestParam(required = false) String action,
    @RequestParam(required = false) Boolean sensitive,
    @RequestParam(required = false) String from,
    @RequestParam(required = false) String to
) {
    LambdaQueryWrapper<SysAuditLog> q = buildQuery(userId, module, action, sensitive, from, to);
    q.orderByDesc(SysAuditLog::getCreatedAt);

    StreamingResponseBody body = out -> {
        try (PrintWriter w = new PrintWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8))) {
            w.write("﻿"); // BOM for Excel
            w.write("时间,用户,模块,action,URI,IP,状态码,sensitive\n");
            // 用 mapper.selectList 分页流式（每 500 行一批）
            int page = 1;
            while (true) {
                Page<SysAuditLog> p = mapper.selectPage(new Page<>(page, 500), q);
                if (p.getRecords().isEmpty()) break;
                for (SysAuditLog r : p.getRecords()) {
                    w.write(csvRow(r));
                }
                if (p.getRecords().size() < 500) break;
                page++;
            }
            w.flush();
        }
    };
    String filename = "audit-log-" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + ".csv";
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
        .contentType(MediaType.parseMediaType("text/csv; charset=utf-8"))
        .body(body);
}

private String csvRow(SysAuditLog r) {
    return String.join(",",
        csvEscape(r.getCreatedAt() == null ? "" : r.getCreatedAt().toString()),
        csvEscape(r.getUsername() == null ? String.valueOf(r.getUserId()) : r.getUsername()),
        csvEscape(r.getModule()),
        csvEscape(r.getAction()),
        csvEscape((r.getRequestMethod() == null ? "" : r.getRequestMethod() + " ") + (r.getRequestUri() == null ? "" : r.getRequestUri())),
        csvEscape(r.getIp()),
        String.valueOf(r.getResponseStatus()),
        Boolean.TRUE.equals(r.getSensitive()) ? "Y" : "N"
    ) + "\n";
}

private static String csvEscape(String s) {
    if (s == null) return "";
    if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
        return "\"" + s.replace("\"", "\"\"") + "\"";
    }
    return s;
}
```

如已有 `buildQuery(...)` private 方法，复用；否则把现有 list endpoint 的 wrapper 构造抽出来。

### 3.3 前端：lib/api/task.ts 加 cancel
- 加 `taskApi.cancel(id)`：POST `/task/{id}/cancel`
- 加 `TASK_CANCEL_AVAILABLE = true`

### 3.4 前端：lib/api/auditLog.ts 加 export
- 加 `auditLogApi.exportUrl(params)`：返回完整 URL（带 query string，浏览器直接 `window.open`）
  ```ts
  exportUrl: (params) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k,v]) => v !== undefined && v !== "" && q.set(k, String(v)));
    return `/api/admin/audit-log/export?${q.toString()}`;
  },
  ```

### 3.5 前端：tasks page 加 cancel 按钮
**修改** `frontend-admin/app/(authed)/tasks/page.tsx`

每行操作列：status=PENDING/RUNNING 时显示「取消」按钮（destructive）：
- 点击 → `confirm("取消任务 #id?")`
- 调 `taskApi.cancel(id)` → toast → 刷新

不要破坏 T9 的「重试」按钮逻辑（FAILED 时显示）。

### 3.6 前端：audit-log page 替换 CSV 导出逻辑
**修改** `frontend-admin/app/(authed)/admin/audit-log/page.tsx`

把 T17 加的「导出 CSV」按钮逻辑（前端拼 CSV）改为：
- `window.open(auditLogApi.exportUrl(currentFilters), "_blank")` 
- 后端 streaming，浏览器直接下载
- 删除前端拼 CSV 的代码（包括 EXPORT_LIMIT 检查；后端 streaming 无限制）

不要动 DateRangePicker / Card 结构（T17 owns）。

### 3.7 编译验证
```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH mvn -DskipTests compile
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T18/T20/T21 范围
- 其他后端 controller / 前端页面

### 输出
1. 2 个新端点 URL
2. compile / tsc 结果
3. tasks/audit-log 改动概述

---

## 4. T20 详细任务（Stepper 抽取 + a11y）

### 4.1 抽 Stepper 到 components/ui/

**新建** `frontend-admin/components/ui/Stepper.tsx`：

```tsx
import { cn } from "@/lib/utils";

export type StepperState = "completed" | "current" | "pending" | "failed";

export type StepperItem = {
  key: string;
  label: string;
  state: StepperState;
};

export function Stepper({
  items,
  className,
}: {
  items: StepperItem[];
  className?: string;
}) {
  return (
    <ol className={cn("flex items-start", className)}>
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        return (
          <li key={it.key} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <div className="flex flex-1 justify-end">
                {i > 0 && (
                  <div
                    className={cn(
                      "h-0.5 w-full",
                      items[i - 1].state === "completed"
                        ? "bg-emerald-500"
                        : "bg-zinc-300 dark:bg-zinc-700"
                    )}
                  />
                )}
              </div>
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  it.state === "completed" && "bg-emerald-500 text-white",
                  it.state === "current" &&
                    "border-2 border-blue-500 bg-blue-500 text-white animate-pulse",
                  it.state === "pending" &&
                    "bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
                  it.state === "failed" && "bg-rose-500 text-white"
                )}
              >
                {it.state === "completed" ? "✓" : it.state === "failed" ? "✗" : i + 1}
              </div>
              <div className="flex flex-1 justify-start">
                {!isLast && (
                  <div
                    className={cn(
                      "h-0.5 w-full",
                      it.state === "completed"
                        ? "bg-emerald-500"
                        : "bg-zinc-300 dark:bg-zinc-700"
                    )}
                  />
                )}
              </div>
            </div>
            <div
              className={cn(
                "mt-2 text-center text-xs",
                it.state === "current" ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {it.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

### 4.2 newstore 用新 Stepper
**修改** `frontend-admin/app/(authed)/newstore/[taskId]/page.tsx`

把 T9 内联 SagaStepper 实现替换为：
```tsx
import { Stepper, type StepperItem } from "@/components/ui/Stepper";

const SAGA_STEPS = [
  { key: "PENDING", label: "开始" },
  { key: "AUTH_DONE", label: "已授权" },
  { key: "MEDIA_UPLOADING", label: "上传媒体" },
  { key: "COLLECTIONS_CREATING", label: "创建集合" },
  { key: "PRODUCTS_PUSHING", label: "推送产品" },
  { key: "GUIDE_DOC_PUSHED", label: "推送指南" },
  { key: "THEME_DEPLOYING", label: "部署主题" },
  { key: "THEME_PUBLISHING", label: "发布主题" },
  { key: "SUCCESS", label: "完成" },
];

function buildItems(currentStep: string, isFailed: boolean): StepperItem[] {
  const idx = SAGA_STEPS.findIndex(s => s.key === currentStep);
  return SAGA_STEPS.map((s, i) => ({
    key: s.key, label: s.label,
    state: isFailed && i > idx ? "pending"
        : isFailed && i === idx ? "failed"
        : i < idx ? "completed"
        : i === idx ? "current"
        : "pending",
  }));
}
```

UI: `<Stepper items={buildItems(state.step, state.failed)} />`。

保留 fallback「Saga 状态读取中」当 idx<0。

### 4.3 a11y: 5 个页面 icon-only button 加 aria-label

grep 一下没有 aria-label 的 icon-only button（如 ▶ ▼ ✓ ✗ 等）。在 5 个高频页加 aria-label：

1. `/orgs` 树展开按钮 + 删除按钮
2. `/admin/role` 矩阵 checkbox
3. `/cross-auth` 「续期」「撤销」按钮（如 icon-only）
4. `/products` 列表行操作按钮
5. `/tasks` 「重试」「取消」「展开子任务」按钮

用 `aria-label="展开子任务"` 等明确文案。

如发现已有 `aria-label`，跳过。

### 4.4 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T18/T19/T21 范围
- 其他页面

### 输出
1. Stepper 组件文件
2. newstore 改动概述
3. a11y 加固的按钮清单
4. tsc 结果

---

## 5. T21 详细任务（products 列表虚拟滚动）

### 5.1 安装 @tanstack/react-virtual
```
cd frontend-admin && pnpm add @tanstack/react-virtual
```

### 5.2 products 列表 wrap virtualizer
**修改** `frontend-admin/app/(authed)/products/page.tsx`

先 Read 看现有列表渲染结构（应是 `<table>` 或 `<div>` 列表）。

加 virtualizer：
```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

const parentRef = useRef<HTMLDivElement>(null);
const rowVirtualizer = useVirtualizer({
  count: filteredItems.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 56, // 每行预估 56px
  overscan: 5,
});

// 渲染：
<div ref={parentRef} className="max-h-[70vh] overflow-auto">
  <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
    {rowVirtualizer.getVirtualItems().map(v => (
      <div key={v.key}
           style={{ position: "absolute", top: 0, left: 0, width: "100%",
                    transform: `translateY(${v.start}px)`, height: `${v.size}px` }}>
        <ProductRow item={filteredItems[v.index]} />
      </div>
    ))}
  </div>
</div>
```

**注意**：
- 仅当 items.length > 50 时启用 virtualizer（短列表用普通渲染避免不必要的 DOM 复杂度）
- 表格 vs 虚拟滚动结合可能麻烦：把 `<table>` 改为 grid-based `<div>` 行（更适合虚拟）；或对每行 `<table><tbody><tr></tr></tbody></table>` 包装（不推荐）。**简化方案**：列表本就是 `<div>` flex 行，直接套；如是 table，先转成 div + grid 模拟表格列宽。
- 保留所有过滤 / 排序 / 分页逻辑

### 5.3 typecheck
```
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T18/T19/T20 范围
- 其他页面

### 输出
1. @tanstack/react-virtual 版本号
2. products/page.tsx 改造前后行数
3. virtualizer 启用阈值（> 50）
4. tsc 结果

---

## 6. 启动检查表

每 track 完工时输出：
1. 创建/修改文件清单
2. compile / tsc 结果
3. 已知 fallback / TODO

合并后我做：
- backend mvn compile + frontend tsc 全量验证
- git commit + push

---

_最后更新：2026-05-03_
