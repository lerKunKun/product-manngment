# 生产部署 step-by-step（T36）

> 编写：Sprint 9 · T36 · 2026-05-03
> 适用：节点 A（应用 + RDS 接入） / 节点 B（asset-worker） / 节点 C（监控 + CF Tunnel） / 跳板机
> 配套：`ops/deploy/cloudflare-tunnel.md` · `ops/deploy/wireguard.md` · `ops/bootstrap/*.sh`
> 不动：`ops/release/*` · `ops/monitoring/*` · `ops/backup/*`
>
> 规格说明：本文按 Sprint 9 §4 的「演练四节点」描述（A=应用+RDS / B=asset-worker / C=监控+CF Tunnel / 跳板机），
> 与《采购清单.md》三节点（A=US 主应用合并 worker / B=HK 跳板+钉钉 / C=SG 监控+CI）侧重不同。
> 实际生产请以《系统设计文档.md》§5.1 为准；本文给的是「按职责拆分」的部署模板。

---

## §0 部署架构图

```
                    ┌─────────────┐
                    │ Cloudflare  │  WAF + Tunnel + Access
                    │ (DNS/CDN)   │
                    └──────┬──────┘
                           │
              ┌────────────┼─────────────┐
              ↓            ↓             ↓
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │ jump host│←─│ 节点 A   │  │ 节点 C   │
       │(WireGuard│  │(应用+RDS)│  │(监控+CF  │
       │   入口)  │  │          │  │ Tunnel) │
       └──────────┘  └────┬─────┘  └──────────┘
                          │
                          │ WireGuard mesh
                          ↓
                    ┌──────────┐
                    │ 节点 B   │
                    │(asset-   │
                    │  worker) │
                    └──────────┘
```

公网入口仅两个：
- 跳板机 SSH（IP 白名单）
- Cloudflare（443 → CF Tunnel → 节点 C / 节点 A）

应用节点（A/B/C）的 sshd 仅监听 WireGuard 网卡，不对公网开放。

---

## §1 服务器规格 + 软件版本

| 节点 | 规格 | 软件 | 用途 |
|---|---|---|---|
| 节点 A | 4C 8G + 200GB SSD | mysql 8 / redis 8 / rabbitmq 4 / java 21 / nginx 1.27 | 应用 + RDS + 中间件 |
| 节点 B | 1C 2G + 50GB SSD | python 3.12 / shopify-cli | asset-worker |
| 节点 C | 2C 4G + 100GB SSD | docker 27 / cloudflared / prometheus 2.55 | 监控 + Tunnel |
| 跳板机 | 1C 1G + 20GB SSD | wireguard / sshd | 内网入口 |

OS 统一 Ubuntu 22.04 LTS。WireGuard 网段固定 `10.88.0.0/24`：
- 跳板机 `10.88.0.1`
- 节点 A `10.88.0.10`
- 节点 B `10.88.0.20`
- 节点 C `10.88.0.30`

---

## §2 部署顺序

| 顺序 | 节点 | 依赖前置 | 验证步骤 |
|---|---|---|---|
| 1 | 跳板机 | 无 | 公网 IP 可 SSH（白名单内）；`wg show` 显示 server up |
| 2 | 节点 A | 跳板机就绪 | 经跳板 ProxyJump 进 A；`mysql -e 'SELECT 1'` / `redis-cli PING` / `systemctl status shopifyhub-backend` 全 active |
| 3 | 节点 C | 节点 A 就绪（提供被抓 metrics target） | grafana 经 CF Tunnel 外网可达；prometheus targets 全 UP |
| 4 | 节点 B | 节点 A WG 互通 | A 上 `curl http://10.88.0.20:8000/health` 返回 200 |

每步完成后再做下一步——避免回头排查跨节点问题。

---

## §3 节点 A step-by-step（应用 + RDS + 中间件）

### 3.1 SSH 进入

```bash
# 跳板机已就绪后从工作机
ssh -J ops@jump.biounetwork.com:2222 ops@10.88.0.10
```

### 3.2 系统初始化

```bash
sudo bash ops/bootstrap/01-install-docker.sh        # docker + compose + ufw + fail2ban
sudo bash ops/bootstrap/02-init-system.sh           # swap / sysctl / ulimit / SSH 改端口
```

关键 sysctl（02 脚本会写）：
- `vm.max_map_count=262144`
- `net.core.somaxconn=4096`
- `fs.file-max=1000000`

ulimit：`nofile 65535` / `nproc 65535`。

### 3.3 WireGuard

参考 `ops/deploy/wireguard.md`，按节点 A 模板配 `/etc/wireguard/wg0.conf`：

```bash
sudo bash ops/bootstrap/03-setup-wireguard.sh A
sudo systemctl enable --now wg-quick@wg0
sudo wg show                  # 期望看到 jump / B / C 三个 peer
ping -c 3 10.88.0.1           # 跳板机
```

### 3.4 安装 mysql 8.0

```bash
sudo apt-get install -y mysql-server-8.0
sudo mysql_secure_installation
```

创建库 + 用户：

```sql
CREATE DATABASE shopifyhub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'shopifyhub'@'localhost' IDENTIFIED BY '<strong-pwd>';
GRANT ALL PRIVILEGES ON shopifyhub.* TO 'shopifyhub'@'localhost';
FLUSH PRIVILEGES;
```

调 `/etc/mysql/mysql.conf.d/mysqld.cnf`：

```ini
[mysqld]
bind-address           = 0.0.0.0
innodb_buffer_pool_size= 4G
max_connections        = 200
character-set-server   = utf8mb4
collation-server       = utf8mb4_unicode_ci

# binlog（PITR 必需）
server-id              = 1
log_bin                = /var/log/mysql/mysql-bin.log
binlog_format          = ROW
binlog_expire_logs_seconds = 604800
```

```bash
sudo systemctl restart mysql
sudo ufw allow from 127.0.0.1 to any port 3306
sudo ufw allow from 10.88.0.30 to any port 3306    # 节点 C scrape mysqld_exporter
```

### 3.5 安装 redis 8

```bash
sudo apt-get install -y redis-server
REDIS_PWD=$(openssl rand -base64 32)
echo "requirepass $REDIS_PWD" | sudo tee -a /etc/redis/redis.conf
sudo sed -i 's/^# *maxmemory .*/maxmemory 1gb/' /etc/redis/redis.conf
sudo sed -i 's/^# *maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf
sudo sed -i 's/^bind .*/bind 127.0.0.1 10.88.0.10/' /etc/redis/redis.conf
sudo systemctl restart redis-server
echo "redis pwd: $REDIS_PWD"   # 写到密码管理器，删除终端记录
```

验证：`redis-cli -a $REDIS_PWD PING` → `PONG`。

### 3.6 安装 rabbitmq 4

```bash
sudo apt-get install -y rabbitmq-server
sudo rabbitmq-plugins enable rabbitmq_management

sudo rabbitmqctl add_vhost shopifyhub
sudo rabbitmqctl add_user shopifyhub '<strong-pwd>'
sudo rabbitmqctl set_user_tags shopifyhub administrator
sudo rabbitmqctl set_permissions -p shopifyhub shopifyhub '.*' '.*' '.*'
sudo rabbitmqctl delete_user guest
```

management UI 端口 15672，仅 WG 网段允许：

```bash
sudo ufw allow from 10.88.0.0/24 to any port 15672
```

### 3.7 安装 java 21

```bash
sudo apt-get install -y openjdk-21-jdk
java -version    # 期望 openjdk version "21.x.x"
```

### 3.8 拉代码 + 构建

```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/shopifyhub app || true
sudo install -d -o app -g app /opt/shopifyhub
sudo -u app git clone <repo> /opt/shopifyhub/src
cd /opt/shopifyhub/src/backend-api
mvn -DskipTests package
sudo install -o app -g app target/backend-api-*.jar /opt/shopifyhub/backend-api.jar
```

### 3.9 systemd unit

`/etc/systemd/system/shopifyhub-backend.service`：

```ini
[Unit]
Description=ShopifyHub Backend
After=network.target mysql.service

[Service]
User=app
EnvironmentFile=/opt/shopifyhub/.env
ExecStart=/usr/bin/java -jar /opt/shopifyhub/backend-api.jar
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable shopifyhub-backend
```

### 3.10 .env 配置（R2 / DB / Shopify）

参考 `配置指南.md` §4。最小骨架：

```bash
sudo install -m 600 -o app -g app /dev/null /opt/shopifyhub/.env
sudo -u app tee /opt/shopifyhub/.env >/dev/null <<'EOF'
SPRING_DATASOURCE_URL=jdbc:mysql://127.0.0.1:3306/shopifyhub?useSSL=false
SPRING_DATASOURCE_USERNAME=shopifyhub
SPRING_DATASOURCE_PASSWORD=<strong-pwd>
SPRING_REDIS_HOST=127.0.0.1
SPRING_REDIS_PASSWORD=<redis-pwd>
SPRING_RABBITMQ_HOST=127.0.0.1
SPRING_RABBITMQ_VIRTUAL_HOST=shopifyhub
SPRING_RABBITMQ_USERNAME=shopifyhub
SPRING_RABBITMQ_PASSWORD=<rmq-pwd>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<...>
R2_SECRET_ACCESS_KEY=<...>
R2_BUCKET=shopify-assets
ASSET_WORKER_URL=http://10.88.0.20:8000
EOF
```

### 3.11 跑 Flyway 迁移

启动一次后端，Flyway 自动执行 V1..V25：

```bash
sudo systemctl start shopifyhub-backend
journalctl -u shopifyhub-backend -f | grep -i flyway
```

期望看到 `Successfully applied N migrations`。

### 3.12 cron 备份 + 清理

```bash
sudo crontab -e -u app
```

追加：

```cron
0 3 * * * /opt/shopifyhub/src/ops/backup/rds-backup.sh
30 4 * * * /opt/shopifyhub/src/ops/backup/audit-purge.sh
```

### 3.13 防火墙规则（ufw）

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <跳板机公网IP> to any port 22 proto tcp
sudo ufw allow from 10.88.0.0/24 to any port 22 proto tcp
# Cloudflare IP 段（https://www.cloudflare.com/ips-v4/）
for ip in $(curl -s https://www.cloudflare.com/ips-v4/); do
  sudo ufw allow from $ip to any port 443 proto tcp
done
sudo ufw allow 51820/udp                     # WireGuard
sudo ufw enable
sudo ufw status numbered
```

### 3.14 nginx 反代

```bash
sudo apt-get install -y nginx
```

`/etc/nginx/sites-available/shopifyhub`：

```nginx
server {
  listen 443 ssl http2;
  server_name api.biounetwork.com admin.biounetwork.com;

  ssl_certificate     /etc/ssl/cf-origin.pem;        # Cloudflare Origin Cert
  ssl_certificate_key /etc/ssl/cf-origin.key;

  location /api/      { proxy_pass http://127.0.0.1:8080; }
  location /oauth/    { proxy_pass http://127.0.0.1:8080; }
  location /webhook/  { proxy_pass http://127.0.0.1:8080; }
  location /          { proxy_pass http://127.0.0.1:3000; }   # frontend-admin
}
```

```bash
sudo ln -s /etc/nginx/sites-available/shopifyhub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 3.15 验证

```bash
systemctl status shopifyhub-backend                # active (running)
curl -k https://127.0.0.1/api/health               # {"status":"UP"}
bash bin/e2e-wave4.sh                              # 全功能回归
```

---

## §4 节点 B step-by-step（asset-worker）

### 4.1 SSH 进入

```bash
ssh -J ops@jump.biounetwork.com:2222 ops@10.88.0.20
```

### 4.2 系统初始化 + WireGuard

```bash
sudo bash ops/bootstrap/01-install-docker.sh
sudo bash ops/bootstrap/02-init-system.sh
sudo bash ops/bootstrap/03-setup-wireguard.sh B
sudo systemctl enable --now wg-quick@wg0
ping -c 3 10.88.0.10                               # 节点 A 必须通
```

### 4.3 安装 python 3.12 + venv

```bash
sudo apt-get install -y python3.12 python3.12-venv
sudo install -d -o app -g app /opt/asset-worker
sudo -u app git clone <repo> /opt/asset-worker/src
sudo -u app python3.12 -m venv /opt/asset-worker/.venv
sudo -u app /opt/asset-worker/.venv/bin/pip install -r /opt/asset-worker/src/asset-worker/requirements.txt
```

### 4.4 安装 shopify-cli

```bash
sudo apt-get install -y nodejs npm
sudo npm install -g @shopify/cli @shopify/theme
shopify version
```

### 4.5 .env（仅 R2 + Shopify CLI 凭证）

```bash
sudo install -m 600 -o app -g app /dev/null /opt/asset-worker/.env
sudo -u app tee /opt/asset-worker/.env >/dev/null <<'EOF'
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<...>
R2_SECRET_ACCESS_KEY=<...>
R2_BUCKET=shopify-assets
SHOPIFY_CLI_THEME_TOKEN=<...>
EOF
```

### 4.6 systemd unit

`/etc/systemd/system/asset-worker.service`：

```ini
[Unit]
Description=ShopifyHub Asset Worker
After=network.target wg-quick@wg0.service

[Service]
User=app
WorkingDirectory=/opt/asset-worker/src/asset-worker
EnvironmentFile=/opt/asset-worker/.env
ExecStart=/opt/asset-worker/.venv/bin/uvicorn app:app --host 10.88.0.20 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now asset-worker
```

### 4.7 防火墙（不暴露公网）

```bash
sudo ufw default deny incoming
sudo ufw allow from 10.88.0.0/24 to any port 22 proto tcp
sudo ufw allow from 10.88.0.10 to any port 8000 proto tcp     # 仅节点 A 调
sudo ufw allow 51820/udp
sudo ufw enable
```

### 4.8 验证

```bash
# 节点 A 上：
curl http://10.88.0.20:8000/health                 # {"status":"ok"}
```

---

## §5 节点 C step-by-step（监控 + Cloudflare Tunnel）

### 5.1 SSH 进入 + 系统初始化

```bash
ssh -J ops@jump.biounetwork.com:2222 ops@10.88.0.30
sudo bash ops/bootstrap/01-install-docker.sh
sudo bash ops/bootstrap/02-init-system.sh
sudo bash ops/bootstrap/03-setup-wireguard.sh C
sudo systemctl enable --now wg-quick@wg0
```

### 5.2 起监控栈

```bash
cd ops/monitoring
sudo docker compose up -d
sudo docker compose ps             # prometheus / grafana / loki / alertmanager 全 healthy
```

### 5.3 配置 prometheus targets

`ops/monitoring/prometheus/prometheus.yml` 中 targets 写 WG IP：

```yaml
scrape_configs:
  - job_name: node-a
    static_configs:
      - targets: ['10.88.0.10:9100']     # node-exporter
      - targets: ['10.88.0.10:9104']     # mysqld-exporter
  - job_name: node-b
    static_configs:
      - targets: ['10.88.0.20:9100']
      - targets: ['10.88.0.20:8000']     # asset-worker /metrics
```

```bash
sudo docker compose exec prometheus kill -HUP 1
```

访问 `http://10.88.0.30:9090/targets` 确认全 UP。

### 5.4 Cloudflare Tunnel

参考 `ops/deploy/cloudflare-tunnel.md`：
1. CF dashboard 创建 tunnel
2. 节点 C 安装 cloudflared
3. ingress：`grafana.biounetwork.com → http://localhost:3001`
4. 启 systemd unit
5. CF Access policy 限制访问者邮箱

### 5.5 blackbox-exporter（探活公网域名）

`ops/monitoring/docker-compose.yml` 已包含。targets 填业务公网域名：`api.biounetwork.com / admin.biounetwork.com`，prometheus 通过 blackbox 探测。

### 5.6 验证

- 浏览器开 `https://grafana.biounetwork.com` → 跳 CF Access 登录 → 进 grafana
- prometheus targets 全部 UP
- alertmanager 测试一条告警 → 钉钉 / 邮件收到

---

## §6 跳板机 step-by-step

最小化职责：sshd（公网，IP 白名单） + WireGuard server。

### 6.1 安装

```bash
sudo apt-get update
sudo apt-get install -y wireguard-tools openssh-server fail2ban ufw
```

### 6.2 sshd 配置

`/etc/ssh/sshd_config`：

```
Port 2222
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers ops
```

```bash
sudo systemctl restart sshd
```

### 6.3 ufw

```bash
sudo ufw default deny incoming
sudo ufw allow from <办公IP白名单> to any port 2222 proto tcp
sudo ufw allow 51820/udp
sudo ufw enable
```

### 6.4 WireGuard server

参考 `ops/deploy/wireguard.md` 跳板机模板。启动：

```bash
sudo systemctl enable --now wg-quick@wg0
sudo wg show                       # listen on 51820, 3 peers
```

### 6.5 验证

```bash
# 工作机
ssh -p 2222 ops@jump.biounetwork.com -- wg show
ssh -p 2222 ops@jump.biounetwork.com -- ping -c 2 10.88.0.10
```

---

## §7 常用运维命令

| 命令 | 用途 |
|---|---|
| `systemctl status shopifyhub-backend` | 后端状态 |
| `journalctl -u shopifyhub-backend -f` | 后端日志（tail） |
| `systemctl restart shopifyhub-backend` | 后端重启 |
| `systemctl status asset-worker` | 节点 B worker 状态 |
| `bash bin/e2e-wave4.sh` | 全功能验证 |
| `bash ops/backup/rds-backup.sh` | 手动备份 |
| `bash ops/backup/restore-sop.md` | 恢复 SOP（按文档操作） |
| `docker compose -f ops/monitoring/docker-compose.yml ps` | 监控栈状态 |
| `wg show` | WireGuard 连通性 |
| `sudo ufw status numbered` | 防火墙规则 |
| `sudo cloudflared tunnel info <name>` | CF Tunnel 状态 |

---

## §8 FAQ

### Q1. 节点 A 起不来 mysql 怎么办

```bash
sudo systemctl status mysql -l
sudo journalctl -u mysql -n 200
```

常见原因：
- `innodb_buffer_pool_size` 设得超过物理内存 → 调小到物理内存的 50%
- `bind-address` 错误（应为 `0.0.0.0` 或 `127.0.0.1`+`10.88.0.10`）
- 端口 3306 被占用 → `sudo ss -lntp | grep 3306`

修复后 `sudo systemctl restart mysql`。

### Q2. 跳板机 SSH 拒绝怎么办（WireGuard 未起）

如果跳板机本身不通：
1. 用云厂商控制台 VNC / Console 登录
2. 检查 ufw：`sudo ufw status` → 是否丢了 IP 白名单
3. 检查 sshd：`sudo systemctl status sshd` → 端口 2222
4. 临时放行：`sudo ufw allow 2222/tcp`

如果跳板机通但下游节点 ProxyJump 失败：
- 跳板机 `wg show` 看 latest handshake，超过 3 分钟说明 peer 没起
- 下游节点同样跑 `wg show` 对比公钥
- 工作机用 `ssh -vvv -J ops@jump:2222 ops@10.88.0.10` 看具体卡哪步

### Q3. Cloudflare Tunnel 502 怎么排查

```bash
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
```

排查顺序：
1. 节点 C 本地 `curl http://localhost:3001` 是否 200（grafana 自身是否起来）
2. ingress 配置（`/etc/cloudflared/config.yml`）的 service URL 是否正确
3. CF dashboard → Tunnel → 是否 healthy
4. CF Access policy 是否拦了 → 临时关 policy 测试

### Q4. backend 启动日志报 `Flyway checksum mismatch` 怎么办

原因：迁移文件被人改过。处理：
1. 不要在生产 `flyway repair` 直接覆盖——先 dump 一份当前 schema
2. 把改过的 V*.sql 还原成 git 中已 applied 的版本（按 `flyway_schema_history.checksum` 反查）
3. 真的需要修历史：写 V<n+1>__fix_xxx.sql，不要改老文件
4. 实在要 repair：`mvn -pl backend-api flyway:repair`，且备份完成后才执行

### Q5. R2 上传 SignatureDoesNotMatch 怎么办

90% 是凭证 / endpoint / 时钟问题：
1. 检查 `.env` 的 `R2_ENDPOINT` 是否带 `https://` 且 host 是 `<account-id>.r2.cloudflarestorage.com`（不要带 bucket 名）
2. `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 是否复制时多了空格 / 换行
3. 节点系统时间：`timedatectl status` → `NTP synchronized: yes`
4. SDK region 是否填了 `auto`（R2 必须 `auto`）
5. 仍不行：用 `aws s3 ls --endpoint-url=$R2_ENDPOINT` 单独验证凭证
