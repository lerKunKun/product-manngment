# 灾备演练 SOP（Disaster Recovery Drill）

> 编写：W4-MON-03 · 2026-05-03 · 0.5 版本（首次演练前 review，演练后回填实际指标）
> 适用：节点 A（应用 + RDS）+ 节点 B（asset-worker）+ 节点 C（监控 + Cloudflare/R2）+ 跳板机
> 触发：(1) 季度演练；(2) 节点不可恢复；(3) RDS 数据损坏 / 误删

---

## 0. 触发分级

| 级别 | 条件 | RTO | RPO |
|---|---|---|---|
| L1 计划演练 | 季度演练，影子环境跑 | N/A | N/A |
| L2 单节点损坏 | 节点 A 失联 > 30min | 2h | ≤ 5min |
| L3 RDS 数据损坏 | 校验失败 / 误删整表 | 4h | ≤ 24h |
| L4 整机房失联 | 节点 A+B 同时失联 | 8h | ≤ 24h |

---

## 1. 演练目标（季度演练）

- 在**影子环境**跑全链路完整恢复 + 一次「一键开店」端到端，证明：
  1. 加密 RDS dump 解密 + 重建可行
  2. R2 资产可读
  3. 钉钉登录 / 推送 / 快照核心链路无回归
- 录制实际 RTO（恢复完成时间）/ RPO（数据丢失窗口）/ 卡点清单
- 输出 `dr-drill-runlog-YYYYMMDD.md` 到 `ops/disaster-recovery/runlogs/`

---

## 2. 前置：验证环境齐全

```bash
# 跳板机（10.0.0.99）已能 SSH 到节点 A/B/C
ssh ops@jump.shopifyhub.internal -- systemctl status sshd

# R2 备份桶最近 1 份 dump 存在
aws s3 ls s3://shopifyhub-backup/ --endpoint-url=$R2_ENDPOINT | tail -3

# 加密密钥可用（不要打印明文）
test -n "$BACKUP_AES_KEY" && echo "BACKUP_AES_KEY OK"

# 影子节点资源（≥ 8C16G + 100GB SSD）
ssh ops@shadow-a "free -m && df -h"
```

---

## 3. 恢复流程（L3 RDS 数据损坏 = 演练主路径）

### 3.1 拿最近一份加密 dump

```bash
# R2 列出最近 1 份（lifecycle 已保证只留最新）
LATEST=$(aws s3 ls s3://shopifyhub-backup/ --endpoint-url=$R2_ENDPOINT \
  | sort | tail -1 | awk '{print $4}')
echo "Latest dump: $LATEST"

aws s3 cp s3://shopifyhub-backup/$LATEST /tmp/$LATEST --endpoint-url=$R2_ENDPOINT
```

### 3.2 AES-256-GCM 解密

```bash
# 期望文件名：db-YYYYMMDD.sql.gz.enc
# 解密用 backend-api/.../core/security/AesGcmUtil 同算法
# CLI 解密辅助脚本：ops/backup/decrypt.sh（输出 .sql.gz）
bash ops/backup/decrypt.sh /tmp/$LATEST /tmp/${LATEST%.enc}
gunzip /tmp/db-*.sql.gz
ls -lh /tmp/db-*.sql

# SHA-256 校验（与 audit_archive_log 或备份脚本输出 sha256 比对）
sha256sum /tmp/$LATEST
# 期望：与 R2 元数据 x-amz-meta-sha256 一致
```

### 3.3 影子环境重建

```bash
# 启动 shadow MySQL（docker-compose.shadow.yml，不挂卷，独立网络）
docker compose -f docker-compose.shadow.yml up -d mysql redis rabbitmq minio

# 等就绪
sleep 20 && mysqladmin -h shadow.mysql -u root -p$MYSQL_ROOT_PASSWORD ping

# 灌入 dump（约 5-15min，视数据量）
mysql -h shadow.mysql -u root -p$MYSQL_ROOT_PASSWORD shopifyhub < /tmp/db-*.sql

# 抽样校验关键表行数
for t in sys_user sys_org store product store_product approval_flow notification_log; do
  cnt=$(mysql -h shadow.mysql -u root -p$MYSQL_ROOT_PASSWORD -N -e "SELECT COUNT(*) FROM shopifyhub.$t")
  echo "$t: $cnt"
done
```

### 3.4 Flyway 状态修复

```bash
# 检查 schema_version 表
mysql -h shadow.mysql -u root -p$MYSQL_ROOT_PASSWORD -e "SELECT * FROM shopifyhub.flyway_schema_history ORDER BY installed_rank DESC LIMIT 5"

# 启动 backend，让 Flyway 校验 checksum
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  SPRING_DATASOURCE_URL=jdbc:mysql://shadow.mysql:3306/shopifyhub \
  mvn spring-boot:run

# 期望：日志 "Successfully validated N migrations"，无 checksum 失配
# 若 V_X 校验失败（极少见，dump 不一致）→ 用 mvn flyway:repair（团队评审后）
```

### 3.5 R2 资产读路径冒烟

```bash
# 影子 backend 启动后，调主题 / 产品图片 presigned URL
curl -sH "Authorization: Bearer $JWT" http://shadow.api.local:8080/api/snapshots/1/presigned-csv
curl -I "<presigned url>"  # 期望 HTTP 200，content-length 与原始一致
```

### 3.6 一键开店 e2e（核心链路冒烟）

```bash
# 跑既有 e2e 脚本（指向 shadow 环境）
SAGA_HOST=http://shadow.api.local:8080 bash bin/e2e-saga.sh
# 期望 18/18 全绿；任何一项失败立即 ROLLBACK + 上报
```

### 3.7 收尾

- 影子环境所有验证通过 → 把演练 runlog 写入 `ops/disaster-recovery/runlogs/dr-drill-YYYYMMDD.md`
- `docker compose -f docker-compose.shadow.yml down -v` 清场
- `rm -f /tmp/db-*.sql /tmp/db-*.enc /tmp/db-*.gz`（避免影子敏感数据残留）

---

## 4. 实际故障切换（L2/L4，非演练）

### 4.1 节点 A 失联（应用 + RDS 主）

1. **5 分钟内 oncall 确认**：跳板机 ping、Cloudflare WAF 状态、Grafana node-exporter
2. **DNS / 域名切流**：`api.shopifyhub.com` CNAME 指向节点 A 备机 / Cloudflare Worker 兜底页
3. **从 R2 拉 dump 重建到备机** → `/api/health` 全绿后切回 DNS
4. **如能回滚 LVM 快照**（LV snapshot 保留 24h），优先回滚而非 dump 重建（RPO < 1h）

### 4.2 RDS 数据损坏（误删 / 误更新）

1. 立即 `FLUSH TABLES WITH READ LOCK` + `pt-online-schema-change` 夹源数据
2. 拉最近 dump 到隔离实例 → 抽出受影响表/行 → 反向 INSERT 回主库
3. 严禁直接 `DROP DATABASE` + restore，主键自增 + 外键级联会破坏在线写流量

### 4.3 R2 桶损坏（极低概率）

R2 是 11 个 9 持久度，损坏前置概率忽略；但若误删：
- Cloudflare R2 默认开启 30 天 versioning，控制台恢复
- 若 versioning 关闭 → 走 RDS 中表里的 r2_key 列重新拉 / 重新生成（snapshots 可重建，theme 资产可重 pull）

---

## 5. 演练频次 + 验收

| 频次 | 范围 | Owner |
|---|---|---|
| 季度（每季度 1 次） | L1 完整路径 | ops + backend 共同 |
| 半年（每 6 月） | L3 整库 dump 解密 + 重建 | ops |
| 全年（每年 1 次） | L4 整机房切换 | 全员 |

**演练验收标准**：
- 实际 RTO ≤ 表 0 中预期值的 1.5 倍
- e2e-saga 18/18 + smoke-test 6/6 全绿
- 钉钉 access_token 刷新链路无回归（演练全程不应 401）
- runlog 已归档（git tracked）

---

## 6. 关键密钥 / 凭证位置

| 名称 | 存放 | 备注 |
|---|---|---|
| BACKUP_AES_KEY | 节点 A `/opt/shopifyhub/.env`（mode 600） | 从节点 C 备份至 1Password ops vault |
| R2 access key | 同上 | 桶级权限，仅 `shopifyhub-backup` + `audit-archive` 写 |
| MYSQL_ROOT_PASSWORD | 节点 A `.env` + 1Password | 演练用临时账号需在事后 ROTATE |
| 钉钉 webhook signing secret | Alertmanager env | 不入仓 |

---

## 7. 已知卡点 / 待补

- ✅ AES 加密备份 + R2 上传（W4-OPS-02）
- ✅ 审计日志月归档（W4-OPS-01）
- ⏳ R2 versioning 默认未开 → 需在 console 显式开启 30 天保留
- ⏳ 影子环境 docker-compose.shadow.yml 待写（首次演练前必做）
- ⏳ AES-GCM 解密 CLI（`ops/backup/decrypt.sh`）依赖 openssl 3.x；macOS 自带 LibreSSL 不支持 GCM —— 用 `brew install openssl@3` 或在 Linux jump 上跑
- ⏳ 真实演练前在 staging 至少跑一次 dry-run，确认 RTO/RPO 实际值

---

_最后更新：2026-05-03（W4-MON-03 初版）_
