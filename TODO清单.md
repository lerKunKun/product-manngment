# TODO 清单 — 配置 + 调试 + 上线前自检

> 维护：Wave 4 收尾时建立（2026-05-03）
> 用途：把分散在各 SOP / README / 模块文档里的「待人工动手」事项汇总到一处，按【外部凭证 / 部署 / 监控 / 调试 / 优化 / 安全 / 合规】分组。
>
> 与《技术债登记.md》互补：技术债＝代码层未还的债；本清单＝运维 / 配置 / 上线层未做的事。
> 与《进度记录.md》互补：进度＝已发生的事；本清单＝未发生但已识别的事。

---

## 0. 上线 P0 阻塞项（必须做完才能切生产）

| # | 事项 | Owner | 参考 |
|---|---|---|---|
| P0-1 | 申请生产 Shopify Public App + redirect_uri 切到 `https://app.shopifyhub.biounetwork.com/api/oauth/shopify/callback` | 产品 + 后端 | `ops/release/shopify-app-checklist.md` |
| P0-2 | 钉钉企业内部 App redirect_uri 同步切线上 | 后端 | `配置指南.md` §3 |
| P0-3 | 生产 RDS 实例（MySQL 8）+ Redis（含 AUTH）+ RabbitMQ（独立 vhost）+ R2（4 桶：themes / product-media / shopifyhub-backup / audit-archive）准备就绪 | 运维 | `采购清单.md` |
| P0-4 | `BACKUP_AES_KEY` 生成（base64 32 字节）+ 节点 A `.env` + 1Password ops vault 双备份 | 运维 | `ops/backup/restore-sop.md` §0 |
| P0-5 | JWT private/public key 生产 RSA 2048 对替换（`backend-api/src/main/resources/keys/`），与 dev 不同 | 后端 | `backend-api/.../core/security/JwtUtil.java` |
| P0-6 | 域名 `app.shopifyhub.biounetwork.com` Cloudflare 解析 + WAF + SSL（自签或 Cloudflare 免费证书） | 运维 | `ops/release/shopify-app-checklist.md` |
| P0-7 | R-8 数据出境标准合同备案（Cloudflare R2 接收方） | 法务 | `ops/release/legal-compliance-checklist.md` §1.2 |
| P0-8 | 隐私政策 + 用户协议中英双语上线（`/privacy` 路由） | 法务 + 前端 | 同上 §1.3 |
| P0-9 | Wave 4 全链路回归（`ops/release/wave4-regression-e2e.md` §6 验收清单全 ✓） | QA | 同名文档 |

---

## 1. 外部凭证 / 第三方账号

> 参见 `配置指南.md` 完整步骤；下表只列**当前未填**或**仍占位**的。

| # | 项目 | 状态 | 操作 | 备注 |
|---|---|---|---|---|
| 1-1 | 钉钉自定义群机器人（ops 告警群） | 🔲 未建 | 钉钉群 → 智能群助手 → 添加机器人 → 关键词 / 加签 → 复制 webhook URL + secret → 填 Alertmanager `ALERTMANAGER_DINGTALK_OPS_URL` | `ops/monitoring/alertmanager/alertmanager.yml` 已就绪 |
| 1-2 | 钉钉 backend warning 群机器人 | 🔲 未建 | 同上，群分开 | `ALERTMANAGER_DINGTALK_BACKEND_URL` |
| 1-3 | `prometheus-webhook-dingtalk` 中转部署到节点 C | 🔲 未部署 | docker run timonwong/prometheus-webhook-dingtalk + 配置文件路由 ops/backend 两个 endpoint | `ops/monitoring/README.md` §钉钉 webhook 中转 |
| 1-4 | SMTP 真凭证（Resend / SendGrid / 阿里云邮件推送） | 🟡 dev 降级日志 | 申请发件域名 + DKIM + SPF → 填 `MAIL_USERNAME` / `MAIL_PASSWORD` | `配置指南.md` §10 |
| 1-5 | Shopify dev store（用 partner 账号免费创建） | 🔲 未建 | partners.shopify.com → Stores → Add store → Development → 给 e2e-saga.sh 测试用 | |
| 1-6 | Cloudflare R2 lifecycle（备份桶仅留最新 1 份） | 🟡 部分 | console → R2 → bucket → Object lifecycle → Delete after 36 hours（兼容时区误差） | rds-backup.sh 也做了 prune |
| 1-7 | 节点 C blackbox-exporter（SSL 证书探测） | 🔲 未部署 | `prom/blackbox-exporter` + targets 列出所有对外域名 | `prometheus/rules/ops-alerts.yml` SslCertExpiring30d 占位等它 |
| 1-8 | 节点 A node-exporter（systemd 而非 docker） | 🟡 dev only | `apt install prometheus-node-exporter` + systemd enable | macOS docker bind-mount 看不到主机磁盘 |
| 1-9 | 多 corpId 钉钉企业（如有第二家公司接入） | 🔲 表空 | INSERT dingtalk_corp 行（app_secret 用 AesGcmUtil 加密后存 encrypted_app_secret） | V1 表 + W4-NTF-03 链路已就绪 |

---

## 2. 部署 / 基础设施

| # | 事项 | 状态 | 操作 |
|---|---|---|---|
| 2-1 | 节点 A（应用 + RDS）采购 / 上架 | 🔲 | 见 `采购清单.md` § 节点 A |
| 2-2 | 节点 B（asset-worker）采购 | 🔲 | 1C2G 即可 |
| 2-3 | 节点 C（监控 + Cloudflare 接入）采购 | 🔲 | 与 A/B WireGuard 互通 |
| 2-4 | 跳板机（jump host）+ WireGuard 内网 | 🔲 | bootstrap/03-setup-wireguard.sh |
| 2-5 | GitHub Actions self-hosted runner 注册到节点 A | 🔲 | bootstrap/08-register-gh-runner.sh |
| 2-6 | systemd unit 文件（backend / asset-worker） | 🔲 | 当前是 nohup / mvn spring-boot:run，需 `shopifyhub-backend.service` |
| 2-7 | RDS 主从（master + read replica） | 🔲 | 单机即可上线，主从是规模化后再做 |
| 2-8 | LV snapshot（节点 A 24h 内回滚） | 🔲 | LVM 创建 snapshot 卷 + cron 每天 |
| 2-9 | cron 安装 backup / archive 脚本 | 🔲 | `crontab -e` 加入 `0 3 * * * /opt/shopifyhub/ops/backup/rds-backup.sh` 等 |

---

## 3. 监控 / 告警 — 待激活 Metric

下列 Prometheus 告警当前是占位，需要 backend 暴露对应 metric 后才会真正触发。Owner 全部是 backend 同学。

| Metric 名 | 模块 | 落地位置 | 关联告警 |
|---|---|---|---|
| `shopifyhub_r2_upload_total{result="success|fail"}` | `file/FileService` + `snapshot/SnapshotGenerationService` | 用 Micrometer counter 包 putObject | R2UploadFailureRate / Critical |
| `shopifyhub_backup_last_success_seconds` | `BackupNotifyController.notifySuccess` | gauge，每次 sh 报告成功时 set | DailyBackupOverdue |
| `shopifyhub_audit_archive_last_success_seconds` | `AuditArchiveScheduler` | 成功时 gauge.set | AuditArchiveOverdue |
| `shopifyhub_notification_send_total{result="sent|failed|skipped"}` | `NotificationSendService.dispatch / retry` | counter | NotificationSendFailureRate |
| `shopifyhub_approval_pending_max_age_seconds` | 新增 `ApprovalMetricExporter` @Scheduled 每分钟 | gauge | ApprovalPendingTooLong |
| `shopifyhub_cross_auth_expiring_24h_count` | 复用 `CrossAuthExpiryScheduler` | gauge.set | CrossAuthExpiringSoon |
| `shopifyhub_store_tokens_expiring_soon` | 复用现有 scheduler | 已有，业务面 OK | StoreTokensExpiringSoon |
| `shopifyhub_auth_login_total{result="success|fail"}` | `AuthService.login` | counter | LoginFailureSpike |
| `aws_rds_cpu_utilization_average` | cloudwatch_exporter（节点 C） | 部署 cloudwatch_exporter | RDSCPUHigh |
| `probe_ssl_earliest_cert_expiry` | blackbox-exporter（节点 C） | 部署 blackbox-exporter | SslCertExpiring* |

预估工作量：~2 PD（10 个 counter/gauge + Prometheus scrape 配置）。

---

## 4. 调试 / 已知问题

| # | 现象 | 优先级 | 临时绕开 | 修复方向 |
|---|---|---|---|---|
| D-1 | `ApprovalEngine.notifyApprovers` 任一角色签批模式只打日志、不展开角色全员发通知 | P2 | 提交时显式指定 `approverId` 而非 `approverRole` | 加 `SysUserRoleMapper.selectByRoleCode` 拿全员 → 批量 notifyUser |
| D-2 | `MultiCorpDingTalkResolver` 所有 corp 都走主企业 client（perCorp token 缓存未实现） | P1 | 仅 1 家公司接入时无影响 | DingTalkApiClient 加 `getAccessTokenForCorp(corpId)` + Redis cache key 区分 |
| D-3 | `rds-backup.sh` openssl GCM 模式依赖 python `cryptography`；缺则降级 CBC（非 GCM） | P2 | 节点 A 提前 `apt install python3-cryptography` | 写 Java CLI 工具替换 shell（与后端同包） |
| D-4 | `audit-purge.sh` 仅处理 product_image / product_doc / template / snapshot 四个有 r2_key 字段的表 | P3 | 当前正确 | 新表带 r2_key 时手动加进 list_db_keys() |
| D-5 | Wave 4 e2e 验证脚本未自动化（`wave4-regression-e2e.md` 需手跑） | P2 | 上线前手跑 1 轮即可 | 抄 `bin/e2e-saga.sh` 风格写 `bin/e2e-wave4.sh`（约 1 PD） |
| D-6 | 通知 retry exhausted 告警 fallback 用钉钉，不发邮件兜底 | P3 | fallback 用户钉钉离线时丢失告警 | 加 fallback email env + Alertmanager critical 路由二次兜底 |
| D-7 | `password_reset_token` 单 IP / 单 email 滥发限流仅 5min 1 次（Redis SETNX）；同 IP 不同 email 不限 | P2 | 当前接受 | 增加 `pwd_reset:lock:ip:<ip>` 5min 内 ≤ 5 次 |
| D-8 | ApprovalDetail 前端 payload 编辑器是 textarea + JSON.parse；非工程用户不友好 | P3 | 工程师操作 OK | 后续按 type 渲染表单（PRODUCT_ACCESS = productId picker；CROSS_COMPANY_AUTH = userId+scope+expires picker） |
| D-9 | InappService.send 把 tenant_id 取自 TenantContext；定时任务 / 异步线程里 TenantContext 为空 | P2 | 系统消息 tenant_id=null 不影响 | scheduler 调 dispatch 前显式 `TenantContext.set(...)` 包一层 |
| D-10 | 通知 channel "INAPP" 当前在 dispatch 内总是写 inapp_message；订阅取消 INAPP 通道时 isSubscribed 已过滤 | OK | — | 已正确，仅 D5 改 e2e 时验证一次 |

---

## 5. 性能优化（按触发条件再做）

> 见《性能优化复盘.md》和《技术债登记.md》。本节只列 Wave 4 新增。

| # | 现象 | 触发再看 |
|---|---|---|
| O-1 | `NotificationSendService.dispatch` 顺序 3 通道（DINGTALK 同步等钉钉返回） | dispatch QPS > 5 时改 `@Async` per-channel |
| O-2 | `AuditArchiveScheduler` 整月行一次性 SELECT + 序列化（内存峰值与行数线性相关） | 单月行 > 500k 时改 stream JDBC + 流式 gzip |
| O-3 | `SubscriptionService.getMySubscriptions` 每次都 selectList(null) 拉全表 event_def | event_def 变动极少，加 1min cache |

---

## 6. 安全 / 合规

| # | 事项 | 状态 | 操作 |
|---|---|---|---|
| S-1 | `SecurityConfig.anyRequest().permitAll()` 仍是 dev 模式（line 39） | ⚠️ | 上线前改 `.authenticated()` + 把 W1-RBAC `@PreAuthorize` 全部到位 |
| S-2 | 多个 `@RequireSensitiveOp` 标记的 API 上线前 audit 一遍 | 🔲 | 跨公司授权撤销 / 审批通过 / 删除回收站 …… |
| S-3 | JWT 黑名单 Redis key 容量监控（防爆破单 Redis） | 🟡 | 加 `auth:blacklist:*` key 数 metric |
| S-4 | Audit log 月归档密钥 rotation 机制 | 🔲 | 当前 BACKUP_AES_KEY 一把走全程；rotate 时旧月数据用旧 key 解 |
| S-5 | 危险操作二次确认 6 位码暴破防护（同 user 5min 5 次） | 🟡 | 当前依赖 Redis TTL，未做计数 |
| S-6 | 密码强度（特殊字符 / 大小写 / 长度 ≥ 12） | 🟡 | 当前仅 ≥ 8 位 |
| S-7 | Refresh token 黑名单（轮换 detection） | 🟡 | access token 已黑名单；refresh 滥用未识别 |

---

## 7. UI / UX 待完善

| # | 事项 | 优先级 |
|---|---|---|
| U-1 | `/approvals/[id]` payload 编辑器换成按 type 渲染的表单（PRODUCT_ACCESS / CROSS_COMPANY_AUTH） | P2 |
| U-2 | `/inbox` 加按事件 category 过滤 + 按时间分组 | P3 |
| U-3 | `/profile` 通知订阅 UI 增加「全选 / 全弃」快捷按钮 | P3 |
| U-4 | 顶部加全局未读 inapp 红点（消费 `/notification/inapp/unread-count` 每 30s） | P2 |
| U-5 | `/approvals` 列表 join 用户名（current_approver_id / applicantId）展示而非只显数字 ID | P2 |
| U-6 | dark mode（shadcn 已支持，需在顶部加 toggle） | P3 |

---

## 8. 文档 / 流程

| # | 事项 |
|---|---|
| DOC-1 | 写 OpenAPI 3.0 完整 spec（当前依赖 Swagger 自动生成，控制器内 @Operation 不全）|
| DOC-2 | 写 Postman collection 给 QA / 集成方使用 |
| DOC-3 | 写故障复盘模板（事件 → 时间线 → 根因 → 修复 → 预防），按事故纠错复用 |
| DOC-4 | 写 onboarding 文档：新人 1 天内能跑通本地全栈 + 提交一个 PR |
| DOC-5 | API rate-limit 文档化（业务面 + Shopify / 钉钉 上游限流） |

---

## 9. 优先级建议（按周排）

**第 1 周（上线前）**：完成全部 §0 P0 项 + §1 1-1..1-4 + §3 关键 metric（前 6 行 backend metric） + §6 S-1。

**第 2 周（上线后第一周）**：§2 部署稳定 + §4 D-2 / D-9 修 + §1 1-7 / 1-8 部署。

**第 3-4 周（稳态运维）**：§4 D-1 / D-5 / D-6 + §6 S-2 / S-3 + §7 U-1 / U-4 / U-5 + §8 DOC-1。

**长尾（按触发条件）**：§5 性能优化 + 《技术债登记.md》#5/#7/#10/#11 各 trigger 命中时。

---

_最后更新：2026-05-03（Wave 4 收尾）_
