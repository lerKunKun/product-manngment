# 备份恢复 SOP（Restore Standard Operating Procedure）

> 编写：W4-OPS-05 · 2026-05-03
> 适用：节点 A RDS（MySQL 8）+ 节点 B asset-worker + R2 资产
> 触发：(1) 数据损坏 / 误删；(2) 节点 A 不可恢复；(3) 季度演练（见 `../disaster-recovery/dr-drill-sop.md`）

---

## 0. 前置确认

```bash
# 1) 确认必备 env（不要打印明文）
test -n "$BACKUP_AES_KEY"       && echo "BACKUP_AES_KEY OK"
test -n "$R2_ENDPOINT"          && echo "R2_ENDPOINT OK"
test -n "$R2_ACCESS_KEY_ID"     && echo "R2 KEY OK"
test -n "$R2_SECRET_ACCESS_KEY" && echo "R2 SECRET OK"
test -n "$MYSQL_PASSWORD"       && echo "MYSQL_PASSWORD OK"

# 2) 工具版本
mysqldump --version    # 期望 8.0.x
aws --version          # 期望 2.x
python3 -c "import cryptography; print(cryptography.__version__)"  # 期望 ≥ 41
```

如果任何一项缺失，**先恢复工具链 + 拉密钥**，再继续。`BACKUP_AES_KEY` 仅在 1Password ops vault 与节点 A `/opt/shopifyhub/.env`（mode 600）。

---

## 1. 拉最近备份（PITR 第一步）

```bash
# R2 备份桶最近 1 份（lifecycle 保证只留 1 份）
LATEST=$(aws s3 ls s3://shopifyhub-backup/ --endpoint-url=$R2_ENDPOINT \
    | grep -E 'db-[0-9]{8}\.sql\.gz\.enc$' \
    | sort | tail -1 | awk '{print $4}')
echo "Latest backup: $LATEST"

aws s3 cp s3://shopifyhub-backup/$LATEST /tmp/$LATEST --endpoint-url=$R2_ENDPOINT

# 读 metadata 验完整性
aws s3api head-object --bucket shopifyhub-backup --key $LATEST \
    --endpoint-url=$R2_ENDPOINT --query 'Metadata' --output json
# 期望字段：{"sha256":"...", "mode":"aes-256-gcm", "iv":"<24-hex>"}
```

---

## 2. SHA-256 校验

```bash
sha256sum /tmp/$LATEST
# 与 head-object 元数据 sha256 比对；不一致 = 文件损坏，再拉一次
```

---

## 3. 解密 + 解压

```bash
# 用配套脚本（GCM 模式，与备份脚本对称）
bash ops/backup/decrypt.sh /tmp/$LATEST /tmp/${LATEST%.enc}
gunzip /tmp/db-*.sql.gz
ls -lh /tmp/db-*.sql
# 期望：恢复到 .sql 明文（每行一句 SQL）；首尾若干行应能看到 INSERT INTO sys_user / store / approval_flow
```

降级路径（CBC 模式备份）见 `decrypt.sh` 注释。

---

## 4. 恢复目标库（**强烈建议先在隔离实例**）

### 4.1 隔离实例（推荐）

```bash
# 在备机用 docker 起一个临时 MySQL，不挂卷，不和主库共享端口
docker run --rm -d --name mysql-restore \
    -p 3399:3306 \
    -e MYSQL_ROOT_PASSWORD=restore-only \
    -e MYSQL_DATABASE=shopifyhub \
    mysql:8.0

# 等就绪
sleep 25 && mysqladmin -h 127.0.0.1 -P 3399 -u root -prestore-only ping

# 灌入
mysql -h 127.0.0.1 -P 3399 -u root -prestore-only shopifyhub < /tmp/db-*.sql

# 抽样校验关键表
for t in sys_user sys_org store store_product approval_flow notification_log audit_archive_log; do
    cnt=$(mysql -h 127.0.0.1 -P 3399 -u root -prestore-only -N \
        -e "SELECT COUNT(*) FROM shopifyhub.$t")
    echo "$t: $cnt"
done
```

### 4.2 直接覆盖主库（**仅整库不可恢复时**）

```bash
# 先停 backend / asset-worker（避免写入产生主键冲突）
sudo systemctl stop shopifyhub-backend asset-worker

# 清空目标库（先备一份当前损坏数据，事故复盘要用）
mysqldump -h $MYSQL_HOST -u root -p$MYSQL_PASSWORD shopifyhub \
    > /tmp/preexisting-shopifyhub-$(date +%s).sql.gz

mysql -h $MYSQL_HOST -u root -p$MYSQL_PASSWORD \
    -e "DROP DATABASE IF EXISTS shopifyhub; CREATE DATABASE shopifyhub CHARACTER SET utf8mb4;"
mysql -h $MYSQL_HOST -u root -p$MYSQL_PASSWORD shopifyhub < /tmp/db-*.sql
```

---

## 5. Flyway 校验

```bash
# 起 backend 让它跑 Flyway validate（不要 migrate，dump 已含全部表）
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
    SPRING_DATASOURCE_URL=jdbc:mysql://127.0.0.1:3399/shopifyhub \
    mvn spring-boot:run

# 期望：日志 "Successfully validated NN migrations"，无 checksum mismatch
# 若出现 V_X checksum 失败：
#   1. 确认 dump 来源版本；
#   2. 团队 review 后 mvn flyway:repair（高危，仅当确定 V_X 内容与 jar 内 V_X.sql 等价）。
```

---

## 6. R2 资产侧验证（图片 / 主题包 / 快照）

```bash
# 任取 3 个 product_image.r2_key 拿 presigned URL 看是否可读
mysql -h 127.0.0.1 -P 3399 -u root -prestore-only shopifyhub \
    -N -e "SELECT r2_key FROM product_image LIMIT 3" \
    | while read key; do
        curl -sI "$(curl -sH "Authorization: Bearer $JWT" \
            http://127.0.0.1:8080/api/files/presign?key=$key)" \
            | head -1
    done
# 期望：HTTP/2 200
```

---

## 7. 端到端冒烟（必跑）

```bash
# bin/smoke-test 6/6
bash bin/smoke-test.sh
# bin/e2e-saga 18/18 一键开店全链路
bash bin/e2e-saga.sh
```

任一失败 → 立即 ROLLBACK + 上报。

---

## 8. 历史审计日志查询（归档恢复）

如需查归档掉的 sys_audit_log（已被 W4-OPS-01 月归档）：

```bash
# 1) 拿归档元数据
mysql -h $MYSQL_HOST -u root -p$MYSQL_PASSWORD shopifyhub \
    -e "SELECT archive_month, r2_bucket, r2_key, sha256, status FROM audit_archive_log WHERE archive_month >= '2026-01' ORDER BY archive_month"

# 2) 下 + 解密 + 解压
aws s3 cp s3://audit-archive/2026/2026-03.jsonl.gz.enc /tmp/ --endpoint-url=$R2_ENDPOINT
bash ops/backup/decrypt.sh /tmp/2026-03.jsonl.gz.enc /tmp/2026-03.jsonl.gz
gunzip /tmp/2026-03.jsonl.gz

# 3) jq 查询（每行一个 JSON 对象）
cat /tmp/2026-03.jsonl | jq 'select(.user_id == 42 and .module == "approval")'
```

---

## 9. 收尾

- [ ] 全部冒烟通过 → 重启 backend / asset-worker
- [ ] 推一条 success 通知到 ops 群
- [ ] 删 /tmp 临时文件（`rm -f /tmp/db-*.sql /tmp/db-*.gz /tmp/db-*.enc`）
- [ ] 把本次操作时间 / 卡点 / 耗时 写到 `ops/disaster-recovery/runlogs/restore-YYYYMMDD.md`
- [ ] 如果 ROTATE 了任何凭证（如临时 root 密码），更新 1Password

---

## 10. RTO / RPO 目标

| 场景 | RTO（恢复完成） | RPO（数据丢失窗口） |
|---|---|---|
| 整库 dump 重建（隔离实例验证后切换） | ≤ 4h | ≤ 24h（昨日 03:00 备份） |
| 仅个别表回滚（用 dump 抽出反向 INSERT） | ≤ 2h | ≤ 24h |
| LV snapshot 回滚 24h 内 | ≤ 30min | ≤ 1h |

---

_最后更新：2026-05-03（W4-OPS-05 初版）_
