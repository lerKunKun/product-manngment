# Wave 4 回归 + 上线前夜 e2e（W4-RLS-03）

> 编写：2026-05-03
> 用途：Wave 4 全链路上线前自检；过 = 可以推生产

---

## 0. 前置（开发机）

```bash
# Java 21 + pnpm + Docker
java -version            # 期望 21.x
pnpm --version           # 期望 ≥ 10.x
docker compose version   # 期望 ≥ 2.x

# 启动依赖（MySQL + Redis + RabbitMQ + MinIO）
bash bin/dev-up.sh

# 启动 backend / frontend / worker（各自终端）
bash bin/dev-backend.sh
bash bin/dev-frontend.sh
cd asset-worker && uvicorn app.main:app --reload --port 8001
```

---

## 1. Flyway 迁移完整性

```bash
mysql -h 127.0.0.1 -P 3307 -u shopifyhub -p$MYSQL_PASSWORD shopifyhub \
    -e "SELECT version, description, success FROM flyway_schema_history WHERE installed_rank > 0 ORDER BY installed_rank"

# 期望末尾几行：
#   V20 hot_query_indexes              SUCCESS
#   V21 init_approval                  SUCCESS  <-- W4-APP-01
#   V22 init_notification              SUCCESS  <-- W4-NTF-01
#   V23 init_inapp_and_password_reset  SUCCESS  <-- W4-MAIL-01
#   V24 init_audit_archive             SUCCESS  <-- W4-OPS-01
```

新建表清单（手动 verify，缺一个就回头查）：
- approval_flow
- approval_log
- notification_event_def（含 ≥ 16 行 seed）
- notification_subscription
- notification_log
- inapp_message
- password_reset_token
- audit_archive_log

---

## 2. 后端冒烟（已有 + 新增）

```bash
# 已有冒烟（Wave 1-3）
bash bin/smoke-test.sh
# 期望 6/6 全绿

# 一键开店（Wave 3）
bash bin/e2e-saga.sh
# 期望 18/18 全绿
```

---

## 3. Wave 4 新功能 e2e

### 3.1 G1 审批中心

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}' \
    | jq -r .data.accessToken)

# 提交一个 PRODUCT_ACCESS 申请
FLOW=$(curl -s -X POST http://localhost:8080/api/approval \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"type":"PRODUCT_ACCESS","payload":{"productId":1,"reason":"测试"},"approverId":1}' \
    | jq -r .data.id)
echo "submitted flow: $FLOW"

# 通过
curl -s -X POST http://localhost:8080/api/approval/$FLOW/approve \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"comment":"OK"}' | jq

# 验证：APPROVED + log 2 条
mysql -h 127.0.0.1 -P 3307 -u shopifyhub -p$MYSQL_PASSWORD shopifyhub \
    -e "SELECT id,status,decided_by,decided_at FROM approval_flow WHERE id=$FLOW;
        SELECT id,action,actor_id FROM approval_log WHERE flow_id=$FLOW ORDER BY id"
```

### 3.2 G2 通知订阅

```bash
# 列事件定义
curl -s http://localhost:8080/api/notification/events \
    -H "Authorization: Bearer $TOKEN" | jq 'keys'
# 期望: ["APPROVAL","INVITATION","OPS","PUSH","STORE","SYSTEM"]

# 拉我的订阅（应 16 条）
curl -s http://localhost:8080/api/notification/subscriptions/me \
    -H "Authorization: Bearer $TOKEN" | jq 'length'

# 改 INVITATION_SENT 通道
curl -s -X PUT http://localhost:8080/api/notification/subscriptions/me \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '[{"userId":1,"eventCode":"INVITATION_SENT","channels":"EMAIL","enabled":true}]' | jq

# 触发一个邀请，看 notification_log 是否只生成 EMAIL 一条（不含 DINGTALK）
mysql -h 127.0.0.1 -P 3307 -u shopifyhub -p$MYSQL_PASSWORD shopifyhub \
    -e "SELECT user_id, event_code, channel, status FROM notification_log
        WHERE event_code='INVITATION_SENT' ORDER BY id DESC LIMIT 5"
```

### 3.3 G3 邮件 + 站内信

```bash
# 忘记密码请求（不需要 JWT）
curl -s -X POST http://localhost:8080/api/auth/password-reset/request \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com"}' | jq
# 期望 {code:0}；查看 backend 日志：[email-stub] BODY 里有 reset 链接

# password_reset_token 表新增一行 used_at NULL
mysql -h 127.0.0.1 -P 3307 -u shopifyhub -p$MYSQL_PASSWORD shopifyhub \
    -e "SELECT id,user_id,email,expires_at,used_at FROM password_reset_token ORDER BY id DESC LIMIT 1"

# 站内信：触发任意通知，inapp_message 应有新行（订阅含 INAPP 通道）
mysql -h 127.0.0.1 -P 3307 -u shopifyhub -p$MYSQL_PASSWORD shopifyhub \
    -e "SELECT id,user_id,event_code,subject,read_at FROM inapp_message ORDER BY id DESC LIMIT 5"

# 前端 /inbox 页面看到该消息
```

### 3.4 G4 审计归档 + 备份

```bash
# 手动触发归档（loopback 限制）
curl -s -X POST http://127.0.0.1:8080/api/ops/backup/audit-archive/run \
    -H "Content-Type: application/json" \
    -d '{"month":"2026-04"}' | jq
# 期望：返回 audit_archive_log 一行 status=SUCCESS

# 验证 R2 上传
aws s3 ls s3://audit-archive/2026/ --endpoint-url=$R2_ENDPOINT

# 备份脚本干跑
DATE=$(date +%Y%m%d) bash ops/backup/rds-backup.sh
aws s3 ls s3://shopifyhub-backup/ --endpoint-url=$R2_ENDPOINT
# 期望：仅 1 份 db-YYYYMMDD.sql.gz.enc

# 解密验证
aws s3 cp s3://shopifyhub-backup/db-${DATE}.sql.gz.enc /tmp/ --endpoint-url=$R2_ENDPOINT
bash ops/backup/decrypt.sh /tmp/db-${DATE}.sql.gz.enc /tmp/db.sql.gz
gunzip /tmp/db.sql.gz && head -20 /tmp/db.sql
# 期望：能看到 SQL 头 + Flyway 表
```

### 3.5 G5 监控

```bash
# 告警规则加载完整
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].name'
# 期望包含: api-health / business / jvm-resource / ops-alerts / infra-placeholder

# Alertmanager 路由 dry-run
amtool config routes --config.file=ops/monitoring/alertmanager/alertmanager.yml \
    test severity=critical alertname=DailyBackupOverdue
# 期望: dingtalk-ops
```

---

## 4. 前端冒烟

```bash
cd frontend-admin && pnpm tsc --noEmit && pnpm build
# 期望：build 成功，新页面均在 routes 列表：
#   /approvals       /approvals/[id]
#   /inbox
#   /forgot-password /reset-password
```

UI 手测路径：
- [ ] /approvals 列表 + 详情通过 / 驳回 / 重提
- [ ] /inbox 未读 / 已读 / 全部标已读
- [ ] /profile 通知订阅矩阵保存 + 刷新仍生效
- [ ] /forgot-password 提交后看后端日志 reset 链接 → /reset-password?token=xxx → 改密 → 用新密登录

---

## 5. 性能 / 慢查询基线

```bash
# 跑既有性能测试
bash bin/smoke-test.sh --perf 2>/dev/null || echo "可选：手动跑 jmeter"

# MySQL 慢日志（>1s 的语句）
mysql -h 127.0.0.1 -P 3307 -u shopifyhub -p$MYSQL_PASSWORD \
    -e "SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 5"
# 期望：归档 / 通知发送涉及的 query 都 < 100ms（日常负载下）
```

---

## 6. 验收清单

- [ ] V21..V24 Flyway 全 SUCCESS
- [ ] backend mvn compile 全绿
- [ ] frontend tsc + build 全绿
- [ ] bin/smoke-test.sh 全绿
- [ ] bin/e2e-saga.sh 全绿
- [ ] G1 审批 e2e 通过 / 驳回 / 重提
- [ ] G2 订阅过滤生效（关闭 DINGTALK 后只生成 EMAIL log）
- [ ] G3 密码重置链 + 站内信 inbox
- [ ] G4 手动归档 + 备份脚本 dry-run
- [ ] G5 Prometheus rules 加载 + Alertmanager 路由
- [ ] Shopify App checklist Section 6 全 ✓
- [ ] 法务 R-8 备案文件齐备

任一未过 → block 上线。

---

_最后更新：2026-05-03（W4-RLS-03 初版）_
