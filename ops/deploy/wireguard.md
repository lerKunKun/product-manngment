# WireGuard mesh 部署

> 配套：`ops/deploy/README.md` §3.3 / §4.2 / §5.1 / §6.4 · `ops/bootstrap/03-setup-wireguard.sh`
> 拓扑：跳板机 ↔ 节点 A / 节点 B / 节点 C（星型 + peer 间互通）
> 网段：`10.88.0.0/24` · UDP 端口 `51820`

---

## 1. 网段与角色

| 角色 | WG IP | 公网 IP（示例） | 职责 |
|---|---|---|---|
| 跳板机 | 10.88.0.1 | jump.biounetwork.com | mesh 入口 + ProxyJump |
| 节点 A | 10.88.0.10 | （不公开） | 应用 + RDS |
| 节点 B | 10.88.0.20 | （不公开） | asset-worker |
| 节点 C | 10.88.0.30 | （不公开） | 监控 + CF Tunnel |

只有跳板机持有公网 endpoint；A/B/C 通过跳板机做 NAT 穿透或互相直连（取决于云厂商网络），首期保守用「跳板机为中心」拓扑。

---

## 2. 安装 wireguard-tools（每节点）

```bash
sudo apt-get update
sudo apt-get install -y wireguard-tools
```

---

## 3. 生成 keys（每节点）

```bash
sudo install -d -m 700 /etc/wireguard
cd /etc/wireguard
sudo umask 077
sudo bash -c 'wg genkey | tee private.key | wg pubkey > public.key'
sudo cat public.key                 # 把公钥贴到下面 4 个 conf 模板对应槽位
```

四台机各跑一次，记录四个公钥：

| 节点 | 私钥（仅本机） | 公钥（贴到其他节点的 PublicKey） |
|---|---|---|
| 跳板机 | `<JUMP_PRIV>` | `<JUMP_PUB>` |
| 节点 A | `<A_PRIV>` | `<A_PUB>` |
| 节点 B | `<B_PRIV>` | `<B_PUB>` |
| 节点 C | `<C_PRIV>` | `<C_PUB>` |

---

## 4. wg0.conf 模板

### 4.1 跳板机 `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address = 10.88.0.1/24
ListenPort = 51820
PrivateKey = <JUMP_PRIV>
PostUp   = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
# 节点 A
PublicKey = <A_PUB>
AllowedIPs = 10.88.0.10/32
PersistentKeepalive = 25

[Peer]
# 节点 B
PublicKey = <B_PUB>
AllowedIPs = 10.88.0.20/32
PersistentKeepalive = 25

[Peer]
# 节点 C
PublicKey = <C_PUB>
AllowedIPs = 10.88.0.30/32
PersistentKeepalive = 25
```

> 跳板机如不做 NAT 转发，可去掉 `PostUp/PostDown` 两行；本模板默认开启便于后续把 A/B/C 流量统一从跳板机出公网（可选）。

### 4.2 节点 A `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address = 10.88.0.10/24
PrivateKey = <A_PRIV>

[Peer]
# 跳板机
PublicKey = <JUMP_PUB>
Endpoint  = jump.biounetwork.com:51820
AllowedIPs = 10.88.0.0/24
PersistentKeepalive = 25
```

### 4.3 节点 B `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address = 10.88.0.20/24
PrivateKey = <B_PRIV>

[Peer]
# 跳板机
PublicKey = <JUMP_PUB>
Endpoint  = jump.biounetwork.com:51820
AllowedIPs = 10.88.0.0/24
PersistentKeepalive = 25
```

### 4.4 节点 C `/etc/wireguard/wg0.conf`

```ini
[Interface]
Address = 10.88.0.30/24
PrivateKey = <C_PRIV>

[Peer]
# 跳板机
PublicKey = <JUMP_PUB>
Endpoint  = jump.biounetwork.com:51820
AllowedIPs = 10.88.0.0/24
PersistentKeepalive = 25
```

> 三台应用节点的 `AllowedIPs` 都写整段 `10.88.0.0/24`：经跳板机即可触达其他 peer。
> 后续如希望 A↔B / A↔C / B↔C 直连（绕开跳板），可在各自 conf 追加对方的 `[Peer]` 段，需对方有公网 endpoint。

---

## 5. 启动 + 开机自启

每台节点（跳板机 + A/B/C）：

```bash
sudo chmod 600 /etc/wireguard/wg0.conf
sudo systemctl enable --now wg-quick@wg0
sudo systemctl status wg-quick@wg0
```

---

## 6. 防火墙规则

跳板机：

```bash
sudo ufw allow 51820/udp
```

节点 A/B/C：

```bash
sudo ufw allow 51820/udp
# sshd 改为只听 wg0：
# /etc/ssh/sshd_config 加 ListenAddress 10.88.0.X
sudo systemctl restart sshd
```

云厂商安全组也需放行 UDP 51820（跳板机入站；A/B/C 出站默认允许）。

---

## 7. 验证连通性

```bash
# 任一节点
sudo wg show
# 期望：每个 peer 都有 latest handshake（最近 < 3min）和 transfer 数据

# 跳板机 ping 其他三台
ping -c 3 10.88.0.10
ping -c 3 10.88.0.20
ping -c 3 10.88.0.30

# 节点 A 经 mesh ping 节点 B
ssh -J ops@jump.biounetwork.com:2222 ops@10.88.0.10 -- ping -c 3 10.88.0.20
```

四个 peer 全部 handshake + 互通 → mesh 就绪。

---

## 8. 排错速查

| 症状 | 排查 |
|---|---|
| `wg show` 没有 latest handshake | 对端 endpoint / 端口 51820 / 公钥贴反；检查 `journalctl -u wg-quick@wg0` |
| `Resource temporarily unavailable` | 配置文件权限不是 600；`sudo chmod 600 /etc/wireguard/wg0.conf` |
| ping 通但 ssh 不通 | sshd 没监听 wg0；检查 `ListenAddress` 和 `ufw status` |
| 公网拨号失败但 LAN 内可通 | 云厂商 UDP 51820 安全组未放行 |
| 偶发掉线 | NAT 设备 timeout，确认每个 peer 都有 `PersistentKeepalive = 25` |
| key 泄露 | `wg genkey` 重生成，所有 peer 同步更新 PublicKey 槽位 |

---

## 9. 密钥生命周期

- 私钥仅留在本机 `/etc/wireguard/private.key`（mode 600，root only）
- 公钥可以明文贴 conf
- 建议每年轮换一次：生成新 keypair → 在所有 peer 同时切换 PublicKey → reload
- 离职 / 失窃：立即重生成对应节点 key + 推送新公钥到所有 peer
