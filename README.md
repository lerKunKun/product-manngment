# Biou × Shopify Hub

Shopify 多店铺资产管理 + 产品库 + 一键开店 + 审批 / 通知 / 监控 一体化控制台。

> **最新阶段**：v0.5.0-rc — Wave 4 完工 + 9 sprint × 37 track 改进迭代收尾
>
> 后端 43 controllers / Flyway V1..V25 / 6 Micrometer metric / 31 测试 case · 前端 35+ 路由 / 17 ui 组件 / TanStack Query / dark mode / i18n 双语 / 7 Playwright spec · ci 7 job / pre-commit hook / 部署 step-by-step。**漏洞清零（16→0）**。
>
> **核心文档**：
> - 📐 [系统设计文档.md](./系统设计文档.md) v1.3 — 总体架构 / 数据流 / 14 章节
> - 🧭 [系统功能说明.md](./系统功能说明.md) — 面向产品 / QA / 新人的功能清单
> - 📊 [改进迭代史.md](./改进迭代史.md) ⭐ — 9 sprint × 37 track 全部交付归档
> - 🔍 [项目检查报告.md](./项目检查报告.md) — 设计 vs 实现 diff 审计
> - 🎨 [前端改进文档.md](./前端改进文档.md) — UX / 缺失界面建议
> - 📋 [TODO清单.md](./TODO清单.md) — 配置 / 调试 / 上线前 9 个 P0 阻塞项
> - 🛠 [配置指南.md](./配置指南.md) — 外部账号申请 + 凭证填入
> - 📅 [开发任务拆解.md](./开发任务拆解.md) — 4 Wave 全部任务清单
> - 📈 [进度记录.md](./进度记录.md) — 开发进度史
> - 🎯 [并行任务编排.md](./并行任务编排.md) — 原始多 track 编排原则
> - 🔧 [技术债登记.md](./技术债登记.md) — 未还代码债（带触发条件）
> - 🚀 [性能优化复盘.md](./性能优化复盘.md) — Wave 3 性能优化总结
> - 🛒 [采购清单.md](./采购清单.md) — 服务器 / 域名 / 第三方账号采购
>
> **运维文档**：[ops/deploy/](./ops/deploy/) 部署 step-by-step · [ops/backup/](./ops/backup/) 备份 + 恢复 SOP · [ops/disaster-recovery/](./ops/disaster-recovery/) DR 演练 · [ops/monitoring/](./ops/monitoring/) 监控栈 · [ops/release/](./ops/release/) 上线材料

---

## 仓库结构

```
.
├── frontend-admin/              # Next.js 15 + React 19 + shadcn/ui + TipTap + TanStack Query
│                                # 35+ 路由 / 17 ui 组件 / dark mode / i18n 双语 / Playwright e2e
├── backend-api/                 # Spring Boot 3.3 + Java 21 + MyBatis-Plus + Flyway V1..V25
│                                # 43 controllers / 6 Micrometer metric / 31 测试 case / jacoco
├── asset-worker/                # FastAPI + Shopify CLI / Admin / R2 SDK
├── ops/
│   ├── bootstrap/               # 服务器开荒脚本 (00-99)
│   ├── deploy/                  # 4 节点 step-by-step + Cloudflare Tunnel + WireGuard mesh
│   ├── monitoring/              # Prometheus + Grafana + Loki + Alertmanager（5 group rules）
│   ├── backup/                  # rds-backup.sh / audit-purge.sh / decrypt.sh / restore-sop.md
│   ├── disaster-recovery/       # dr-drill-sop.md（季度演练）
│   └── release/                 # Shopify App / 法务 / Wave 4 e2e 清单
├── bin/                         # dev-up / dev-backend / dev-frontend / smoke-test / e2e-saga / e2e-wave4
├── .github/workflows/           # CI 7 job：前端 / 后端 + jacoco / worker / trivy / e2e-wave4 / e2e-frontend
├── .githooks/                   # pre-commit (敏感文件 / secret pattern / tsc / mvn 增量)
├── docker-compose.dev.yml       # 本地开发栈：mysql:8 + redis + rabbit + minio
└── *.md                         # 设计 / 进度 / 功能 / TODO / 改进迭代史 等
```

---

## 核心能力一览

| 模块 | 功能 | 详细 |
|---|---|---|
| **认证** | 钉钉扫码 + 用户名密码 + 临时员工邀请 + 密码重置 | §3 §4 系统功能说明 |
| **组织 + RBAC** | 钉钉部门同步 + 10 角色 + 23 权限点 + 数据范围拦截器 | §2 |
| **店铺管理** | Custom App / OAuth 双接入 + token 30d 过期提醒 + 合作者店铺池 | §4 |
| **产品库** | 完整产品数据 + CSV 42 列 import/export + R2 媒体 + TipTap 富文本 | §5 |
| **推送** | 单/批量推送 + 媒体替换 + 冲突 PENDING + RabbitMQ 异步 | §6 |
| **快照** | 主题资产快照 + 产品快照（webhook 5min 去抖）+ 价格/库存历史 | §7 |
| **任务** | 异步任务 + Saga 状态机 + SSE 进度 | §8 |
| **一键开店** | 12 步 saga（OAuth → 主题 → 产品 → settings → 验证）| §9 |
| **跨公司授权** | 时效必填 + 24h 提醒 + 二次确认撤销 | §10 |
| **模板库 + 指导** | base_template + guide_doc | §11 |
| **审批中心** ⭐W4 | PRODUCT_ACCESS / CROSS_COMPANY_AUTH + 通过/驳回/重提/撤回 + 单签/角色任一 | §12 |
| **通知订阅** ⭐W4 | 16 事件 × 3 通道（钉钉/邮件/站内信）+ 多 corpId + 失败 4 次重试 | §13 |
| **站内信** ⭐W4 | inapp_message + 通知中心前端 | §14 |
| **审计 + 备份** ⭐W4 | sys_audit_log 月归档（gzip + AES-256-GCM → R2）+ 每日加密 dump | §17 |
| **监控** ⭐W4 | Prometheus 5 group rules + Alertmanager ops/backend 分流 + DR 演练 SOP | §18 §19 |

⭐ = Wave 4 新增

---

## 快速开始（本地开发）

### 前置依赖

| 软件 | 版本 | 安装 |
|---|---|---|
| Colima + Docker | 最新 | `brew install colima docker docker-compose docker-buildx` |
| Java | 21 | `brew install openjdk@21` |
| Maven | 3.9+ | （macOS 自带或 brew） |
| Node.js | 20+ | （brew / nvm） |
| pnpm | 10+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| Python | 3.12 | （brew / pyenv） |

### 一键启动

```bash
# 0. 首次：起 Colima
colima start --cpu 4 --memory 8 --disk 60

# 1. 起 docker 中间件（MySQL 3307 / Redis 6380 / RabbitMQ 5672/15672 / MinIO 9000/9001）
./bin/dev-up.sh

# 2. 后端（新终端 tab）
./bin/dev-backend.sh

# 3. 前端（新终端 tab）
./bin/dev-frontend.sh

# 4. 端到端冒烟
./bin/smoke-test.sh           # 6/6
./bin/e2e-saga.sh             # 18/18 一键开店全链路
./bin/e2e-wave4.sh            # Wave 4 全功能 ~28 步（审批/通知/邮件/归档/监控/admin）
```

### 默认入口

| URL | 用途 | 凭证 |
|---|---|---|
| http://localhost:3000 | 前端控制台 | `admin` / `admin123` |
| http://localhost:8080/api/health | 后端探活 | — |
| http://localhost:15672 | RabbitMQ UI | `guest` / `guest` |
| http://localhost:9001 | MinIO Console | `minioadmin` / `minioadmin` |
| http://localhost:9090 | Prometheus（启动 ops/monitoring 后） | — |
| http://localhost:3001 | Grafana | `admin` / `admin` |

---

## 数据库迁移（Flyway）

24 个迁移版本（V1..V24）。运行 backend 时自动应用，启动日志会打印 `Successfully validated 24 migrations`。

| 范围 | 内容 |
|---|---|
| V1..V3 | 平台 + RBAC + dev seed |
| V4..V7 | 店铺 + 产品 + 富文本 |
| V8..V12 | 资产 / 产品快照 / 推送 / saga step |
| V13..V19 | 模板库 / 跨公司 / 预览 / 通知字段 |
| V20 | 热点查询索引补全（性能优化复盘） |
| V21 | ⭐ 审批中心（approval_flow + approval_log） |
| V22 | ⭐ 通知订阅（event_def + subscription + log，含 16 事件 seed） |
| V23 | ⭐ 站内信 + 密码重置 token |
| V24 | ⭐ 审计月归档元数据 |

---

## 开发约定

- **分支**：`main`（prod，受保护）/ `develop`（staging）/ `feature/*` / `hotfix/*`
- **Commit**：约定式提交 `feat/fix/refactor/docs/chore/test(scope): subject`
- **Code Review**：所有 MR 至少 1 人通过 + CI 全绿才能合
- **跨模块禁止直调 Service**，必须走 RabbitMQ 事件
- **跨数据源事务禁止**
- **Flyway 版本号**：每 track 预占（详见《并行任务编排.md》§7）
- **pre-commit hook**：首次启用 `chmod +x .githooks/pre-commit && git config core.hooksPath .githooks`（敏感文件 / secret pattern / frontend tsc / backend mvn compile 4 项检查）

详见《系统设计文档》14 节。

---

## 上线前自检

参见 [TODO清单.md](./TODO清单.md) §0：**9 个 P0 阻塞项**，每项必须 ✓ 才能切生产。

> 提示：`配置信息.md` 含真实凭证不入仓库（已 .gitignore）；生产凭证存放规则见 §6 安全合规。

---

## 当前阶段

🎉 **v0.5.0-rc**（Wave 4 完工 + 9 sprint × 37 track 改进收尾）

### Wave 阶段

| Wave | 状态 | 范围 |
|---|---|---|
| Wave 0 | ✅ 9/9 | monorepo + Spring Boot + FastAPI + Next.js + docker compose + GitHub Actions |
| Wave 1 | ✅ 业务 100% | 多数据源 / 钉钉登录 / 邀请 / 组织同步 / 危险操作 / 数据范围 / 审计 / 回收站 / 个人中心 / 店铺接入 / 产品库 |
| Wave 2 | ✅ | 资产快照 / 产品快照 / 推送 / webhook / Status sync / 监控基础 |
| Wave 3 | ✅ | 一键开店 saga / 合作者店铺池 / 模板库 / 指导文档 / 跨公司授权 / 性能优化 |
| Wave 4 | ✅ | 审批 / 通知订阅 / 邮件 + 站内信 / 审计归档 / 备份 / 监控完善 / 灾备 / 上线材料 |

### 9 个改进 Sprint（37 track）

| Sprint | 主题 | 详情 |
|---|---|---|
| Sprint 1 | 后端关键修复 + admin controllers + 前端 Shell + 采购 + admin 2 页 | [编排](./并行改进编排.md) |
| Sprint 2 | /orgs + /admin/role + dashboard 折线 + Breadcrumb + tasks/saga/stores 增强 | [编排](./并行改进编排-Sprint2.md) |
| Sprint 3 | 后端 5 endpoints + 产品历史 + cross-auth 增强 + ops + 6 ui 组件 | [编排](./并行改进编排-Sprint3.md) |
| Sprint 4 | 4 ops endpoints + TanStack Query + Dark mode + 4 页重构 | [编排](./并行改进编排-Sprint4.md) |
| Sprint 5 | E2E 自动化 + task cancel + Stepper + virtualizer | [编排](./并行改进编排-Sprint5.md) |
| Sprint 6 | 后端补 5 endpoints + Query 扩展 + CI 加固 + datasources UI | [编排](./并行改进编排-Sprint6.md) |
| Sprint 7 | datasource 完整化 + i18n 试点 + 后端测试 + Playwright | [编排](./并行改进编排-Sprint7.md) |
| Sprint 8 | i18n v2 + Playwright 扩展 + 后端测试扩展 + 依赖升级（漏洞 16→0）| [编排](./并行改进编排-Sprint8.md) |
| Sprint 9 | i18n v3 + jacoco + 部署文档 + Mock Shopify | [编排](./并行改进编排-Sprint9.md) |

完整归档见 [改进迭代史.md](./改进迭代史.md)。

### 数字总览

- 4 个子项目（backend / asset-worker / frontend-admin / ops）
- **后端**：43 controllers / Flyway V1..V25 / 6 Micrometer metric / 31 测试 case / jacoco
- **前端**：35+ 路由 / 17 ui 组件 / TanStack Query / dark mode / i18n 双语 ~300 key / 7 Playwright spec
- **CI/CD**：7 job（含 e2e-wave4 + e2e-frontend Playwright）+ pre-commit hook 4 检查
- **运维**：5 group Prometheus rules + 10+ ops 脚本 + 4 节点部署 step-by-step（978 行文档）
- **安全**：0 漏洞（next 15.0.3 → 15.5.15 + postcss 8.5.10+ override）

---

## 测试覆盖率

跑后端测试 + 生成 jacoco HTML 报告：

```bash
cd backend-api && mvn test
open target/site/jacoco/index.html
```

CI 自动跑测试 + 上传 jacoco artifact 30 天保留。

**当前覆盖**：~31 case 横跨 Approval / Inapp / NotificationLog / SysAuditLog / SysRole / BackupNotify。
**v1.0 目标**：60% 行覆盖率。

---

## 安全审计

### 依赖审计（每月跑一次）

```bash
# 前端
cd frontend-admin && pnpm audit --audit-level moderate
cd frontend-admin && pnpm outdated

# 后端
cd backend-api && mvn versions:display-dependency-updates
cd backend-api && mvn dependency-check:check  # 需先装 plugin
```

### 已知漏洞处置原则

| 严重度 | SLA | 处置 |
|---|---|---|
| CRITICAL / HIGH | 48 h | 立即升 patch（同 major.minor），不等下个 sprint |
| MODERATE | 下个 sprint | 评估业务影响后升级 |
| LOW / INFO | 技术债登记 | 不阻塞，纳入清债计划 |

### 安全工具链

- **Pre-commit hook** (`.githooks/pre-commit`) — 4 项检查：
  - 拒绝提交敏感文件（.env / 配置信息.md / *.key / *.pem）
  - Secret pattern 检测（shpss_ / atE / sk_live_ / wpat_ / shpat_）
  - 前端 tsc 增量
  - 后端 mvn compile 增量
- **GitHub Trivy scan** — `.github/workflows/ci.yml` security-scan job 每次 push
- **运行时告警** — 钉钉 ops 群 `BACKUP_FAIL` `HIGH_RISK_OP` `R2UploadFailureCritical` 等
- **审计归档** — sys_audit_log 月归档至 R2（AES-256-GCM）+ 7 年留存

### 启用 pre-commit hook

```bash
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

---

## License

Internal — Biou network 内部使用，未授权第三方分发。
