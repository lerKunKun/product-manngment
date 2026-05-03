# Cloudflare Tunnel 部署（节点 C）

> 配套：`ops/deploy/README.md` §5.4
> 目的：让外网通过 Cloudflare 访问节点 C 的 grafana / prometheus，源站不暴露公网 IP，且加 Access SSO。

---

## 1. CF Dashboard 创建 tunnel

1. 登录 `https://one.dash.cloudflare.com`
2. 左侧栏 `Networks → Tunnels` → `Create a tunnel`
3. Connector type 选 `Cloudflared` → Next
4. Tunnel name 填 `prod-monitoring-c` → Save tunnel
5. 在 "Install and run a connector" 页选 Linux 64-bit → 把 `Token` 一栏完整 token 复制，妥善保存（之后步骤会用）
6. 暂时不要点 Next，先在节点 C 上把 cloudflared 装好

---

## 2. 节点 C 安装 cloudflared

```bash
# 通过跳板进入节点 C
ssh -J ops@jump.biounetwork.com:2222 ops@10.88.0.30

# 添加 cloudflare 仓库
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt-get update
sudo apt-get install -y cloudflared
cloudflared --version
```

---

## 3. 安装 systemd unit + token

```bash
sudo cloudflared service install <粘贴第 1 步 token>
```

该命令自动：
- 创建 `/etc/systemd/system/cloudflared.service`
- 把 token 写进 `/etc/cloudflared/config.yml` 中 `tunnel-credentials`
- `systemctl enable --now cloudflared`

验证：

```bash
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
# 期望日志：Registered tunnel connection ... connIndex=0
```

回到 CF Dashboard 第 1 步页面，刷新可见 Connector status: Active。点 Next。

---

## 4. ingress 配置（子域 → 本地端口）

CF Dashboard → 该 tunnel → `Public Hostname` → `Add a public hostname`：

| Subdomain | Domain | Service |
|---|---|---|
| grafana | biounetwork.com | http://localhost:3001 |
| prometheus | biounetwork.com | http://localhost:9090 |
| alertmanager | biounetwork.com | http://localhost:9093 |

每加一条 CF 自动写 DNS CNAME 到 tunnel UUID。

> 也可以在节点 C 直接编辑 `/etc/cloudflared/config.yml`：
>
> ```yaml
> tunnel: <tunnel-uuid>
> credentials-file: /etc/cloudflared/<tunnel-uuid>.json
> ingress:
>   - hostname: grafana.biounetwork.com
>     service: http://localhost:3001
>   - hostname: prometheus.biounetwork.com
>     service: http://localhost:9090
>   - hostname: alertmanager.biounetwork.com
>     service: http://localhost:9093
>   - service: http_status:404
> ```
>
> 然后 `sudo systemctl restart cloudflared`。Dashboard 配置和 config.yml 二选一，不要混用。

---

## 5. Cloudflare Access policy（限制访问者）

CF Dashboard → `Zero Trust → Access → Applications → Add an application`：

1. Type: `Self-hosted`
2. Application name: `Monitoring`
3. Session Duration: `8 hours`
4. Application domain: `grafana.biounetwork.com`（再 Add another：`prometheus.*` / `alertmanager.*`）
5. Identity providers: 勾 `One-time PIN`（最简）或绑 Google Workspace
6. Save → 进入 policy 编辑

Policy 1 — `Allow ops team`：
- Action: Allow
- Include → Emails ending in: `@biounetwork.com`
- 或 Include → Emails: `ops@biounetwork.com, sre@biounetwork.com`

Policy 2 — `Block everyone else`（可选，默认就是非 Allow 即拒）：
- Action: Block
- Include → Everyone

保存。

---

## 6. 验证（外网走 Access）

工作机浏览器（不要在节点 C 内）打开：

```
https://grafana.biounetwork.com
```

期望：
1. 跳到 Cloudflare Access 登录页
2. 输 ops 邮箱 → 收到一次性 PIN（或 Google SSO）
3. 输入 PIN → 跳到 grafana 登录页
4. grafana admin 登录后能看到节点 A/B/C 的指标

排错：
- 如果直接 502，看 §7
- 如果跳到 Access 但提示 `That account does not have access`：policy 邮箱域名没匹配上
- 如果 Access 通过后 grafana 502：节点 C 的 grafana 容器没起，`docker compose ps`

---

## 7. 排错速查

| 症状 | 排查 |
|---|---|
| `cloudflared` 起不来 | `journalctl -u cloudflared -n 200`；token 错或过期 → CF Dashboard 重新生成 |
| 公网 502 | 节点 C 本地 `curl http://localhost:3001` 是否 200；ingress service URL 是否对 |
| Access 不弹登录 | DNS 是否真指向 tunnel（`dig grafana.biounetwork.com`，期望 CNAME 到 `*.cfargotunnel.com`） |
| 登录后 grafana 502 | grafana 容器 `docker logs mon-grafana`；端口 3001 是否被占 |
| 同 IP 频繁挑战 | CF Dashboard → Access → Application → 调 Session Duration |

---

## 8. 备份 / 恢复

tunnel credential（`/etc/cloudflared/*.json`）丢失等于 tunnel 失效，需要：
- 备份该文件到密码管理器（与 R2 凭证同级保管）
- 或 CF Dashboard 删旧 tunnel 重建（DNS CNAME / ingress / Access policy 都要重做）

建议把 tunnel UUID + token 写进《配置信息.md》的 Secrets 表（带掩码）。
