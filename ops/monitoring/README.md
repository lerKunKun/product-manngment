# Monitoring Stack

Standalone Prometheus + Grafana + Loki + Promtail + Alertmanager stack for the Shopify management platform. Local dev today, production deploy on node C later.

## Start

```bash
cd ops/monitoring
docker compose up -d
```

## Stop

```bash
docker compose stop      # preserve volumes
docker compose down -v   # wipe all data
```

## URLs

| Service      | URL                          | Credentials   |
| ------------ | ---------------------------- | ------------- |
| Grafana      | http://localhost:3001        | admin / admin |
| Prometheus   | http://localhost:9090        | -             |
| Loki         | http://localhost:3100        | -             |
| Alertmanager | http://localhost:9093        | -             |

Override Grafana admin password via `GRAFANA_ADMIN_PASSWORD` env var before `up`.

## Roadmap

- W2-MON-01: stack + plumbing. ✅
- W2-MON-02: scrape targets (node-exporter, JVM). ✅
- W2-MON-03: Grafana dashboards. ✅
- W2-MON-04: alert rules + 钉钉 webhook receiver. ✅
- W4-MON-01: 完整阈值（磁盘 < 20% / R2 上传失败 > 5% / SSL < 30d / 备份逾期 36h / 审计归档 35d / 通知发送失败 / 审批超期）. ✅ rules/ops-alerts.yml
- W4-MON-02: Alertmanager → 钉钉 ops 独立群 + warning 路由分流 + critical inhibit. ✅ alertmanager/alertmanager.yml
- W4-MON-03: 灾备演练 SOP. ✅ ../disaster-recovery/dr-drill-sop.md

## 钉钉 webhook 中转（W4-MON-02）

Alertmanager 不直接调钉钉机器人 webhook，因为：
1. 钉钉机器人需要带签名 (`timestamp` + HMAC-SHA256)，Alertmanager 原生 webhook_config 不支持
2. 不同告警分流到 ops / backend 独立群，每个群一组 access_token + secret

推荐用 `prometheus-webhook-dingtalk`（开源）做中转：

```
docker run -d --name dingtalk-webhook \
  -p 8060:8060 \
  -v ./dingtalk-config.yml:/etc/prometheus-webhook-dingtalk/config.yml:ro \
  timonwong/prometheus-webhook-dingtalk:latest
```

`dingtalk-config.yml` 配两个 target：
- `/dingtalk/ops/send` — ops 群机器人 access_token + secret
- `/dingtalk/backend/send` — backend 群机器人 access_token + secret

在 docker-compose.yml 加该服务并 link 到 monitoring network 即可上线。

## 已知未激活的 metric（占位告警）

下列告警依赖后端尚未暴露的 metric，等接入后自然激活：

| Metric | Owner | 备注 |
|---|---|---|
| `shopifyhub_r2_upload_total{result="success|fail"}` | backend `file/FileService` + `snapshot/SnapshotGenerationService` | 加 Micrometer counter |
| `shopifyhub_backup_last_success_seconds` | `ops/backup/rds-backup.sh` 上传成功后写到 backend `/ops/backup/notify-success` 接口 | gauge，单位 unix ts |
| `shopifyhub_audit_archive_last_success_seconds` | `AuditArchiveScheduler` 成功时写 gauge | 同上 |
| `shopifyhub_notification_send_total{result}` | `notification/subscription/NotificationSendService` | counter |
| `shopifyhub_approval_pending_max_age_seconds` | backend 暴露 ApprovalFlow 表 PENDING 最久秒数 | gauge |
| `shopifyhub_cross_auth_expiring_24h_count` | `CrossAuthExpiryScheduler` 跑前导出 | gauge |
| `aws_rds_cpu_utilization_average` | cloudwatch_exporter（节点 C） | 仍占位 |
| `probe_ssl_earliest_cert_expiry` | blackbox_exporter（节点 C） | 仍占位 |

## Scrape targets (W2-MON-02)

| Job                  | Endpoint                                          | Notes                                  |
| -------------------- | ------------------------------------------------- | -------------------------------------- |
| `prometheus`         | `localhost:9090`                                  | Self-scrape.                           |
| `node-exporter`      | `node-exporter:9100`                              | Host CPU/mem/disk. macOS 仅看到 Docker VM 视角；生产改 `10.0.0.1:9100`、`10.0.0.2:9100`（节点 A/B WG IP）。 |
| `cadvisor`           | `cadvisor:8080`                                   | Per-container metrics.                 |
| `shopifyhub-backend` | `host.docker.internal:8080/api/actuator/prometheus` | macOS/Windows 走 `host.docker.internal`；生产替换 `10.0.0.1:8080`。 |
