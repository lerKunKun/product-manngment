# Biou × Shopify Hub

Shopify 多店铺资产管理 + 产品库 + 一键开店 + 审批 / 通知 / 监控 一体化控制台。

> **最新阶段**：Wave 4 完成（v0.4.0-rc）— 审批中心 / 钉钉订阅 / 站内信 / 审计归档 / 灾备 / 上线材料齐全
>
> **核心文档**：
> - 📐 [系统设计文档.md](./系统设计文档.md) v1.3 — 总体架构 / 数据流 / 14 章节
> - 🧭 [系统功能说明.md](./系统功能说明.md) — 面向产品 / QA / 新人的功能清单
> - 📋 [TODO清单.md](./TODO清单.md) — 配置 / 调试 / 上线前自检事项
> - 🛠 [配置指南.md](./配置指南.md) — 外部账号申请 + 凭证填入步骤
> - 📅 [开发任务拆解.md](./开发任务拆解.md) — 4 个 Wave 全部任务清单（带状态）
> - 📈 [进度记录.md](./进度记录.md) — 开发进度史（按时间倒序）
> - 🎯 [并行任务编排.md](./并行任务编排.md) — 多 track 并行开发指引
> - 🔧 [技术债登记.md](./技术债登记.md) — 未还的代码债（带触发条件）
> - 🚀 [性能优化复盘.md](./性能优化复盘.md) — Wave 3 性能优化总结
> - 🛒 [采购清单.md](./采购清单.md) — 服务器 / 域名 / 第三方账号采购

---

## 仓库结构

```
.
├── frontend-admin/              # Next.js 15 + React 19 + shadcn/ui + TipTap（21 路由）
├── backend-api/                 # Spring Boot 3.3 + Java 21 + MyBatis-Plus + Flyway V1..V24
├── asset-worker/                # FastAPI + Shopify CLI / Admin / R2 SDK
├── ops/
│   ├── bootstrap/               # 服务器开荒脚本 (00-99)
│   ├── deploy/                  # 各节点 docker-compose
│   ├── monitoring/              # Prometheus + Grafana + Loki + Alertmanager
│   ├── backup/                  # rds-backup.sh / audit-purge.sh / decrypt.sh / restore-sop.md
│   ├── disaster-recovery/       # dr-drill-sop.md（季度演练）
│   └── release/                 # Shopify App / 法务 / Wave 4 e2e 清单
├── bin/                         # dev-up / dev-backend / dev-frontend / smoke-test / e2e-saga
├── .github/workflows/           # CI（4 job 并行：前端 / 后端 / worker / trivy）
├── docker-compose.dev.yml       # 本地开发栈：mysql:8 + redis + rabbit + minio
└── *.md                         # 设计 / 进度 / 功能 / TODO 文档
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

详见《系统设计文档》14 节。

---

## 上线前自检

参见 [TODO清单.md](./TODO清单.md) §0：**9 个 P0 阻塞项**，每项必须 ✓ 才能切生产。

> 提示：`配置信息.md` 含真实凭证不入仓库（已 .gitignore）；生产凭证存放规则见 §6 安全合规。

---

## 当前阶段

🎉 **Wave 4 完工**（v0.4.0-rc）

| Wave | 状态 | 范围 |
|---|---|---|
| Wave 0 | ✅ 9/9 | monorepo + Spring Boot + FastAPI + Next.js + docker compose + GitHub Actions |
| Wave 1 | ✅ 业务 100% | 多数据源 / 钉钉登录 / 邀请 / 组织同步 / 危险操作 / 数据范围 / 审计 / 回收站 / 个人中心 / 店铺接入 / 产品库 |
| Wave 2 | ✅ | 资产快照 / 产品快照 / 推送 / webhook / Status sync / 监控基础 |
| Wave 3 | ✅ | 一键开店 saga / 合作者店铺池 / 模板库 / 指导文档 / 跨公司授权 / 性能优化 |
| Wave 4 | ✅ | 审批 / 通知订阅 / 邮件 + 站内信 / 审计归档 / 备份 / 监控完善 / 灾备 / 上线材料 |

总计：4 个子项目（backend / asset-worker / frontend-admin / ops），24 个 Flyway migration，21 个前端路由，5 组 Prometheus rules，10+ ops 脚本。

---

## License

Internal — Biou network 内部使用，未授权第三方分发。
