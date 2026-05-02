# Wave 2 配置占位清单

> 用途：记录 Wave 2 各 track 引入的**新配置项 / env 变量**，以及它们的"开发默认值"和"生产真实值"占位。
> 原则：**dev 默认值必须能让代码跑通，不阻塞开发**；生产值在《配置指南.md》对应章节落地后回填本表。
> 编排日期：2026-05-02

---

## 0. 速查表

| 项 | 出处 | dev 默认 | 生产占位 | 阻塞？ |
|---|---|---|---|---|
| `WORKER_DRY_RUN` | W2-AST-02 worker | `true`（dev 显式开） | `false` | 否 |
| `R2_REGION` | W2-AST-02 worker | `auto` | `auto`（Cloudflare R2） | 否 |
| `SHOPIFY_API_VERSION` | W2-AST-02 worker | `2024-10` | 同 dev | 否 |
| Shopify CLI 二进制 | W2-CLI-01 worker | 未安装 → dry-run | 节点 A 装 `shopify` CLI + `shopify store auth` 走过一次 | 否（dry-run 兜底） |
| Prometheus 节点 A/B targets | W2-MON-02 ops | `host.docker.internal` / 容器内服务名 | `10.0.0.1:9100` / `10.0.0.2:9100`（WG 私网 IP） | 否（dev 跑本地容器） |
| Prometheus backend target | W2-MON-02 ops | `host.docker.internal:8080` | `10.0.0.1:8080` | 否 |
| `GRAFANA_ADMIN_PASSWORD` | W2-MON-01 ops | `admin`（compose 默认） | 强密码 + Cloudflare Access 二次门 | 否（监控面板内网/Access 守护） |

> 没有任何一项**强阻塞**。哪怕 Shopify CLI / R2 / Cloudflare 都没接，dev 也能跑通业务逻辑（dry-run 模式）+ 监控栈（本地 host 指标）。

---

## 1. asset-worker 端（Track A）

### 1.1 `WORKER_DRY_RUN` —— 跑路开关

- **作用**：`POST /pull/theme` 等 worker 端点跳过真实 Shopify Admin API，返回合成 manifest（3 个伪文件），让前后端联调不依赖外部凭证。
- **dry-run 现在也真上传到 R2/MinIO（如已配）**，让 SNAP-04 端到端链路能跑到 SUCCESS：合成的 product.json / image-*.{jpg,png} / manifest.json 会以确定性内容写入 R2，backend `SnapshotGenerationService.downloadBytes(productJsonKey)` 能取到字节而不是 NoSuchKey 404。R2 没配（缺 endpoint/key/secret/bucket）时上传失败被吞掉只 WARN，dry-run 仍返回 in-memory manifest，与改动前行为一致，所以 dev-without-MinIO 也不阻塞。
- **dev 默认**：`.env` 加一行 `WORKER_DRY_RUN=true`。
- **生产**：移除或设 `false`；同时确保 R2 + Shopify CLI 已就绪。
- **何时切**：W2-AST-02..04 全部完工 + Shopify Partner App + R2 凭证落地后切 false 跑端到端测试。

```bash
# .env (dev)
WORKER_DRY_RUN=true
```

### 1.2 R2 凭证 —— 走 Cloudflare R2，复用既有

`asset-worker/app/config.py` 读这些：

| env | dev 默认（来自 docker-compose.dev.yml MinIO） | 生产 |
|---|---|---|
| `R2_ENDPOINT` | `http://localhost:9000` | `https://<account>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | `minioadmin` | Cloudflare R2 token Access Key |
| `R2_SECRET_ACCESS_KEY` | `minioadmin` | Cloudflare R2 token Secret Key |
| `R2_BUCKET` | `shopify-assets-dev` | `shopify-assets-prod`（或按拆分） |
| `R2_REGION` | `auto` | `auto` |

> 已在《配置指南.md》§5 Cloudflare R2 章节有对应步骤。新增项只是 `R2_REGION=auto`。

### 1.3 Shopify CLI

- **dev**：不强求安装。`ShopifyCliClient.get_token()` 第一次调用会 subprocess `shopify store auth <shop>`；找不到二进制 → 返回 `ShopifyCliError` → route 转 503。
- **生产**：节点 A 安装 Shopify CLI，且 `shopify store auth example.myshopify.com` 跑过一次（产生本地 token 缓存）。
- **占位动作**：W1-INF-01 节点 A 初始化时加一步 `npm i -g @shopify/cli @shopify/theme`（或对应 brew）。

### 1.4 Shopify Admin API 版本

| env | 默认 | 生产 |
|---|---|---|
| `SHOPIFY_API_VERSION` | `2024-10` | 跟最新稳定版（每季度评估） |

不阻塞。

---

## 2. backend-api 端（Track B）

W2-AST-01 + W2-SNAP-01 全是 Flyway + 实体 + Mapper，**没有引入新 env**。

> 后续 W2-SNAP-02（webhook 接收）会引入 `SHOPIFY_WEBHOOK_SECRET`，到时再加进本表。

### 2.1 Shopify webhook 共享密钥（W2-SNAP-02）

| env | dev 默认 | 生产 |
|---|---|---|
| `SHOPIFY_WEBHOOK_SECRET` | 空 → 跳过 HMAC 校验 + 日志 WARN | Partner App API secret key |

- **作用**：`POST /webhook/shopify/products/{create,update,delete}` 接收 Shopify 推送时，按 raw body 计算 HMAC-SHA256 + base64，与 `X-Shopify-Hmac-Sha256` 头常量时间比较。
- **dev 默认**（`.env.example` 已留 `SHOPIFY_WEBHOOK_SECRET=` 空行）：空字符串 → `ShopifyHmacVerifier.verify` 直接返回 true 并 WARN 一次，dev 可不接 Partner App 也能联调。
- **生产**：必须从 Shopify Partner Dashboard → App → API credentials → "API secret key" 拷贝填入；填错或缺失则所有 webhook 一律 401。
- **不阻塞**：dev 默认值能让代码跑通；切换到生产前回填即可。

### 2.2 Webhook 去抖时间（W2-SNAP-03）

| env | dev 默认 | 生产 |
|---|---|---|
| `SHOPIFY_SNAPSHOT_DEBOUNCE_SECONDS` | `300`（5 分钟） | 同 dev，可调 |

- 同一 (store, product) 在该窗口内多次 webhook → 只产生一次下游快照任务。
- 走 RabbitMQ TTL + DLX 模式（不依赖 delayed_message_exchange 插件）。
- 路径：`shub.snapshot.delay` exchange → `snap.delay` queue（TTL=N×1000）→ DLX → `shub.snapshot.process` exchange → `snap.process` queue → 消费者标 RUNNING（W2-SNAP-04 填实际生成逻辑）。
- Redis key：`snap:debounce:{storeId}:{productExternalId}`，TTL 同 debounce-seconds；NX 失败即视为窗口内重复 webhook，仅插 PENDING 行不发 MQ。
- **失败兜底**：MQ 发送失败会主动 `DEL` Redis key 让下次 webhook 可重试；Redis/MQ 任一不可用都不阻塞 webhook 200 响应。

---

## 3. ops 监控（Track F）

### 3.1 Grafana 管理员密码

| env | 默认 | 生产 |
|---|---|---|
| `GRAFANA_ADMIN_PASSWORD` | `admin`（compose 文件里 `:-admin` 兜底） | 长随机串 + 写《配置信息.md》|

```bash
# 启动监控栈时
GRAFANA_ADMIN_PASSWORD='changeme-strong' docker compose -f ops/monitoring/docker-compose.yml up -d
```

生产再叠 Cloudflare Access 守护 `monitor.biounetwork.com` —— 已在《配置指南.md》§4.5。

### 3.2 Prometheus scrape targets

`ops/monitoring/prometheus/prometheus.yml` 当前 4 个 job：

| job | dev target | 生产替换 |
|---|---|---|
| `prometheus` | `localhost:9090` | 不变 |
| `node-exporter` | `node-exporter:9100`（容器内服务） | `10.0.0.1:9100`, `10.0.0.2:9100` —— 节点 A/B WireGuard 私网 IP |
| `cadvisor` | `cadvisor:8080`（容器内服务） | 同 dev（生产监控节点 C 上一份；节点 A/B 不必要） |
| `shopifyhub-backend` | `host.docker.internal:8080` + `metrics_path: /api/actuator/prometheus` | `10.0.0.1:8080`，path 不变 |

文件内已用 `# 生产替换：...` 行注释占位，落地 W1-INF-02 WG mesh 后直接改这行 + reload prometheus 即可。

### 3.3 节点 A/B 上 node-exporter 安装（W1-INF 阶段做）

dev 是用容器跑 node-exporter；生产改为 Linux 节点 systemd 安装：

```bash
# 节点 A/B 上（W1-INF-01 之后）
ARCH=linux-amd64
curl -L https://github.com/prometheus/node_exporter/releases/download/v1.8.2/node_exporter-1.8.2.${ARCH}.tar.gz | tar xz
sudo install node_exporter-*/node_exporter /usr/local/bin/
# 写 systemd unit 监听 0.0.0.0:9100，但 ufw 仅放行 WG 私网段
```

---

## 4. 落地动作清单（按时间顺序）

| 阶段 | 动作 | 配置项 |
|---|---|---|
| 现在 dev | `.env` 加 `WORKER_DRY_RUN=true` | §1.1 |
| W2-AST-02 联调时 | 启动 worker：`WORKER_DRY_RUN=true uvicorn app.main:app` | §1.1 |
| W1-INF-01 服务器到位 | 节点 A 装 Shopify CLI + R2 真实桶 + 跑一次 `shopify store auth` | §1.2, §1.3 |
| W1-INF-02 WG mesh 通 | 把 prometheus.yml 的 `host.docker.internal` 改成节点 IP | §3.2 |
| W1-INF-12 上线前 | 生成 `GRAFANA_ADMIN_PASSWORD` 强密码 → 写 《配置信息.md》| §3.1 |
| W2-SNAP-02 推进时（待） | Shopify webhook secret → `.env` | §2 备注 |

---

## 5. 不阻塞的证据

| 场景 | 现状 | 验证 |
|---|---|---|
| 没装 Shopify CLI | dry-run 通；非 dry-run → 503（不崩） | `WORKER_DRY_RUN=true POST /pull/theme` 返回 manifest ✓ |
| 没接真 R2 | dev 用 MinIO；R2Client 懒加载，没用就不报错 | backend + worker 启动 ✓ |
| 没接 Shopify webhook secret | webhook 路径还没实现（W2-SNAP-02 才加） | 不阻塞 ✓ |
| 没接节点 A/B | dev 用容器 node-exporter 替代 | Prometheus targets 全 up ✓ |
| 没接 Grafana 强密码 | 默认 admin/admin，本地访问 OK | http://localhost:3001 ✓ |

> 任何 Wave 2 后续任务都不应该因为"配置没填"被阻塞。如果哪一项变成阻塞了，把它加到本表 + 加 dry-run / mock 兜底。

---

## 6. W2-MON-03 Grafana 业务看板 dashboard provisioning（无需 env 配置）

- **dashboard 文件**：`ops/monitoring/grafana/dashboards/shopifyhub-overview.json`（uid `shub-overview`，12 个面板）。
- **provisioning 路径**：Grafana 容器启动时自动加载 `/var/lib/grafana/dashboards`（Day 1 已挂载 `./grafana/dashboards`，本次直接落 JSON 即可）。
- **无新增 env / 配置项**：复用 Day 1 的 `GRAFANA_ADMIN_PASSWORD`（dev 默认 `admin`）+ Day 2 的 Prometheus 数据源（uid `prometheus`）。
- **Micrometer 业务指标**：后端三处埋点（`shopifyhub_auth_login_total`、`shopifyhub_store_tokens_expiring_soon`、`shopifyhub_invitation_expired_total`）通过既有 `/api/actuator/prometheus` 端点暴露，无需任何新配置；后端重启后即生效。
- **占位面板**：`shopifyhub_push_failures_total` / `shopifyhub_task_duration_seconds_bucket` 在 W2-PUSH 任务落地前显示 "No data"，结构已就位。
- **生产差异**：无（dev = 生产，仅看板登录密码按 §0 速查表替换）。

---

## 7. W2-MON-04 告警规则 + 钉钉 webhook

### 7.1 Prometheus rule files
- 4 个 rule 文件挂在 `ops/monitoring/prometheus/rules/`：api-health / jvm-resource / business / infra-placeholder
- 共 12 条规则；其中 5 条带 `placeholder:` 标签（需 rabbitmq-exporter / cloudwatch-exporter / blackbox-exporter / W4-OPS backup metrics 落地后自动激活）
- dev 验证：`curl http://localhost:9090/api/v1/rules | jq '.data.groups | length'` 应 ≥ 4

### 7.2 Alertmanager 钉钉 webhook

| 项 | dev 默认 | 生产 |
|---|---|---|
| 钉钉告警群 webhook URL | `http://localhost/null`（不发） | 钉钉群机器人 webhook（带签名校验） |

- 文件：`ops/monitoring/alertmanager/alertmanager.yml` 的 `receivers[name=dingtalk].webhook_configs[0].url`
- 替换动作：拿到群机器人 webhook → 直接编辑 yaml → `docker compose restart alertmanager`
- **不阻塞**：告警仍会被 Prometheus 采集 + 在 Alertmanager UI（http://localhost:9093）可见，仅"不主动发到群"

---

## 8. W2-AST-05 SSE 进度回调（worker → backend → frontend）

| env | dev 默认 | 生产 |
|---|---|---|
| `BACKEND_PROGRESS_URL` (worker) | 空 → ProgressEmitter no-op，pull 仍正常 | `https://api.biounetwork.com` |
| `INTERNAL_API_TOKEN` (worker + backend) | 空 → backend 跳过 token 校验 + WARN | 32 字节 base64 随机串（≥两端一致）|
| `app.internal.token` (backend YAML，从 `INTERNAL_API_TOKEN` 取值) | 同上 | 同上 |

- 不阻塞：env 缺失时 worker 不发事件、backend 不校验，但 SSE 通道仍可用（拿不到事件而已）。
- 拓扑：worker `POST /api/internal/asset/progress` → backend Redis 缓存 last-event TTL 1h + fan-out 给所有订阅同 snapshot_id 的 SseEmitter（订阅迟到时立刻 replay last-event）→ frontend `GET /api/asset/snapshot/{id}/events` 长连接收事件。

---

## 9. W2-SNAP-04 快照生成 worker base URL

| env | dev 默认 | 生产 |
|---|---|---|
| `SHOPIFY_WORKER_BASE_URL` | `http://localhost:8765` | 节点 A 内网 / WG IP，例如 `http://10.0.0.1:8765` |
| `SHOPIFY_WORKER_TIMEOUT_SECONDS` | `120`（2 分钟） | 调到 300+ 大产品图多 |

- 不阻塞：worker 不可达时 SnapshotGenerationService 把对应 `product_snapshot` 行标 FAILED + 写 error_message，不卡住消费者。
- dry-run 路径：把 worker `WORKER_DRY_RUN=true`（已在《Wave2-配置占位.md》§1.1 兜底），消费者也能跑通整条链路。

---

## 10. W2-PUSH-01+02 push 表 + worker /push/product

- 新表：`store_product`, `store_product_variant`, `task`, `push_conflict` （Flyway V10）
- 无新增 env / 配置项
- dry-run：worker `/push/product` 走 `WORKER_DRY_RUN=true` 兜底（已在 §1.1）

---

## 11. W2-SNAP-05 价格/库存历史（无新增配置）

- 不引入新 env / 配置项
- webhook 收到 `products/update|create` 时，对 payload.variants 逐个跟历史最近一行比对：值变化才插入 `product_price_history` / `product_inventory_history`
- currency 暂硬编 `USD`（TODO：W3-PUR 时从 store 配置读）
- 失败 swallow + log，不影响 webhook 200 返回

---

## 12. W2-PUSH-03+04 媒体推送 + 冲突落库（无新增 env）

- Worker `/push/product` 现接受 `product_payload.media_r2_keys: list[str]`：从 R2 下载图片 → base64 → 注入 Shopify create payload 的 `images[].attachment`（追加在调用方提供的 `images[].src` 之后）。dry-run 直接合成 base64，不走 R2。
- R2 拉取失败统一抛 `R2FetchError`（继承 `ShopifyAdminError`），route 层映射为 502，**不阻塞** dry-run 链路。
- Backend 新增 `POST /push/product { productId, storeId, triggeredBy? }` → `PushService` 编排：
  1. 读取 `product`/`product_variant`/`product_image` + `store`（解密 access_token）
  2. 构造 Shopify payload（variants 强制 `inventory_quantity=1000` + `inventory_policy=continue`）
  3. 写 `task` 行 PENDING→RUNNING → 调 worker（HTTP/1.1）
  4. 200 无冲突 → `task` SUCCESS + upsert `store_product`；200 有冲突 → `task` PARTIAL + 写 `push_conflict` PENDING；422/502/超时 → `task` FAILED + 错误信息（422 同时落 `push_conflict` VALIDATION）
- 复用 §9 的 `SHOPIFY_WORKER_BASE_URL` + `SHOPIFY_WORKER_TIMEOUT_SECONDS`，无新增 env。
- TODO(W1-RBAC)：`/push/product` 当前走 `permitAll()`，待 RBAC 上线后挂 `PRODUCT:PUSH` 权限。
- TODO(W2-PUSH-06+)：`product_image` 增加 `r2_key` 列后，`PushService.buildProductPayload` 自动填充 `media_r2_keys`；当前空列表 → worker 跳过 R2 下载。

---

## 13. Tech debt #6 闭环（产品图片 R2 key）

- V12 给 product_image 加 r2_key VARCHAR(512) NULL；PushService 已读取该字段填入 media_r2_keys
- 现有行 r2_key 全 NULL，等 ProductImageController/CsvService 上传路径回填后自然激活

---

## 14. Tech debt 状态 + W2-SYNC（多店铺同步）

- 全量同步 cron：`SHOPIFY_SYNC_FULL_CRON` 默认 `0 0 4 * * *`（每天 04:00），dev 同生产，写在 `application-dev.yml#shopify.sync.full-cron`
- webhook handler `/webhook/shopify/app/uninstalled` 在收到 Shopify app uninstall 时把 `store.status` 标 `UNINSTALLED`（无 schema 变更，V4 已有该枚举值）
- webhook handler `/webhook/shopify/shop/update` 当前只 log + 200，不更新本地表（shop name / email / currency 不可操作）
- W2-SYNC-02 当前是骨架（`StatusSyncService.syncStore` 仅日志统计 mapped_products），真实"Shopify 拉取 + diff 修正"是 W3 territory（需要 worker GraphQL 分页 + bulk operations + 新 `/sync/store-products` 端点）
- 不阻塞：webhook handler 永远 200（除 HMAC mismatch 401）；调度异常 swallow 不让 scheduler 线程崩

---

## 15. W2-PUSH-05 + W2-PUSH-07 + W2-PUSH-08（批量 / 失败通知 / 审计）

- 批量推送：新增 `POST /push/batch { productIds:[], storeId, triggeredBy? }`，返回 `{parentTaskId, subTaskIds:[...], summary:{success,failed,partial}}`。父任务 type=PRODUCT_PUSH，子任务通过 `task.parent_task_id` 回链。
- **限制（Day 7 已知）**：当前是同步循环（`PushService.pushBatch` 内 for-loop 调 `push()`），大批量会阻塞 HTTP 请求；前端建议拆小批量调用 + 轮询 task 状态。**TODO（W3+）**：异步队列化（Spring `@Async("taskExecutor")` + 父任务 PENDING→RUNNING→终态，或者接入 RabbitMQ 推送队列），调用方立刻拿到 parentTaskId 并轮询。原型代码可参照本任务说明里的"option A: PushAsyncWorker 拆 bean"模式。
- 失败钉钉通知（W2-PUSH-07）：`NotificationEventCode.PRODUCT_PUSH_FAIL`（已存在）；`PushService.push()` 三个失败分支（IOException / 422 validation / 非 2xx worker）统一走 `notifyPushFail()`，调 `NotificationDispatcher.notifyUser(...)`（钉钉 + 邮件兜底）。
  - 收件人：优先 `triggeredBy`；缺省走 `shopify.push.fail-notify-fallback-user-id`（默认 `1`，与 `StoreTokenScheduler` 同惯例）。
  - 容错：dispatch 异常 swallow + WARN，不影响 task 状态写库。
- 审计（W2-PUSH-08）：复用现有 `AuditAspect`（`@within @RestController`），`PushController` / `TaskController` 自动落 `sys_audit_log`，**无代码改动**。dev 验证：`SELECT request_uri, request_method FROM sys_audit_log WHERE request_uri LIKE '%/push/%' ORDER BY id DESC LIMIT 5;` 应同时看到 `/push/product` 与 `/push/batch` 两类 URI。
- 无新增 Flyway / 表 / 必填 env；仅可选 `shopify.push.fail-notify-fallback-user-id`。
- 兼容性：原 `POST /push/product`（同步，单品）签名 + 行为不变。
- 复用：`ShopifyHmacVerifier`、`StoreMapper`、`StoreProductMapper`，无新增 Flyway / 表 / env（仅 cron 一项可选 env）

---

## 16. W2-SYNC-03 状态广播（无新增配置）

- Product 表 status 变更（active/draft/archived）触发对所有已映射 store 的 push 同步
- 同步循环（与 W2-PUSH-05 同样限制：大 fan-out 阻塞 HTTP；TODO 异步化）
- 跳过：store_product.status ∈ {NOT_PUSHED, FAILED}；store.status = UNINSTALLED
- 失败 swallow + log，不影响本次产品 update 的 200 返回
- 入口：`ProductService.update` 提交本地行后调 `ProductStatusBroadcaster.broadcastStatusChange(productId, oldStatus, newStatus)`
- 触发任务：`task.type=PRODUCT_PUSH`，`triggered_by=NULL`（系统 fan-out，区别于用户主动推送）
- 不变：原 `PUT /product/{id}` 签名/响应不变；仅在 status 变化时多发 N 条 PRODUCT_PUSH task

---

## 17. W3-NEW-01 saga 框架（无新增 env）

- V13 给 task 加 saga_step / saga_data_json / saga_attempt 三列
- SagaService 提供 start / advance / fail / retry / executeStep API；W3-NEW-02..08 各步业务实现来挂入
- SagaController 暴露 GET /saga/{id} 查状态，POST /saga/{id}/retry 重试
- 不引入新 env / 配置项

---

## 18. W3-DS-01 跨公司授权（无新增强制 env）

- V16 给 `sys_data_scope` 加 3 列：`cross_company TINYINT(1)` / `revoked_at TIMESTAMP NULL` / `granter_company_id BIGINT NULL`；并把 `source` 枚举扩到 `('CROSS_AUTH','INVITATION','APPROVAL')`；新增索引 `idx_data_scope_cross_expiry (cross_company, status, expires_at)`。`granted_by` / `expires_at` 在 V1 已存在，V16 不重复加。
- 跨公司授权（`POST /cross-auth`）必须带 `expires_at`，区间 `[now+5min, now+180d]`；`source='APPROVAL'`，`cross_company=1`；走 `@RequireSensitiveOp("CROSS_AUTH_GRANT")` 二次确认。
- 撤销 `POST /cross-auth/{id}/revoke` 走 `@RequireSensitiveOp("CROSS_AUTH_REVOKE")`，把 status 切 `REVOKED` + 写 `revoked_at`；DataScopeInterceptor 仅匹配 `status='ACTIVE'`，自动屏蔽。
- `CrossAuthExpiryScheduler` 是 W3-DS-03 骨架（24h 提醒 + 0:05 硬过期），当前仅打 debug 日志；触发 cron 由 env 控制，**不阻塞**：

| env | dev 默认 | 含义 |
|---|---|---|
| `RBAC_CROSS_AUTH_EXPIRY_WARN_CRON` | `0 0 * * * *` | 整点扫即将过期 |
| `RBAC_CROSS_AUTH_EXPIRE_CRON` | `0 5 0 * * *` | 每天 00:05 硬过期 |

- 不引入 RBAC 鉴权变更、不改 DataScopeInterceptor、未做 W3-DS-02 前端 / W3-DS-03 真实通知。

---

## 19. W3-PV-01 合作者店铺池（无新增 env）

- `store.is_dev_store` / `is_partner_collab` 列已在 V4 落库（`TINYINT(1) NOT NULL DEFAULT 0`），`Store.java` 实体侧也早就有；本次仅新增 `V14__store_partner_collab_indexes.sql` 给 `(is_partner_collab,status)` / `(is_dev_store,status)` 各加一条复合索引（用 `information_schema` 兜底，重复执行不报错），无 schema 变更。
- 新管理端点（均挂 `@RequireSensitiveOp`，走钉钉验证码二次确认）：
  - `POST /store/{id}/mark-partner-collab` → action `STORE_MARK_PARTNER_COLLAB`
  - `POST /store/{id}/unmark-partner-collab` → 同上
  - `POST /store/{id}/mark-dev-store` → action `STORE_MARK_DEV_STORE`
- `GET /store` 扩展 `?partnerCollab=true|false&devStore=true|false` 过滤；列表 dto 新增 `isPartnerCollab` 字段（前端可据此画"合作者"标签）。
- 新增 `GET /store/pool/partner-collab?available=true&tenantId=...`（`StorePoolController`）：当前直接列出所有 partner-collab 标记的店铺；`available=true` 过滤 TODO 等 W3-PV-03 的 `preview_theme` 表落地后接容量限制。
- 不阻塞：所有 dev store / 合作者池字段都有缺省值（false），既有 `connectCustomApp` 流程不变。

---

## 20. W3-NEW-02 saga OAuth + dev mock

| env | dev 默认 | 生产 |
|---|---|---|
| `SHOPIFY_DEV_MOCK_OAUTH` | `true`（`POST /saga/{id}/dev-mock-auth` 可绕过真 OAuth）| `false` |
| `SHOPIFY_OAUTH_CALLBACK_BASE` | `http://localhost:8080/api` | `https://api.<域>/api` |
| `SHOPIFY_SAGA_FRONTEND_BASE` | `http://localhost:3000/newstore` | `https://admin.<域>/newstore` |

- 真实 OAuth 路径：`POST /saga/start { tenantId, shopDomainHint, ... }` 返 `{ taskId, oauthUrl }` → 前端跳转 → Shopify 同意 → `GET /oauth/saga-callback?code&shop&state` → store 入库 + saga `INIT → AUTH_DONE`。
- `state = base64url(taskId) + "." + base64url(HMAC-SHA256(taskId, key))`，HMAC key 优先 `SHOPIFY_APP_SECRET`，缺失时 fallback 到 `ENCRYPT_KEY_AES_GCM`（dev 简化方案；生产 W3-NEW-12 加固再换专用密钥 + Redis state 缓存）。
- Dev mock：`POST /saga/{taskId}/dev-mock-auth { shopDomain, accessToken }` 直接落 store + saga 推进，**不调** Shopify Admin API、不要求公网回调；`shopify.dev-mock-oauth=false` 时该入口拒绝。
- `store.token_type` 仍写 `oauth`（兼容现 ENUM `('cli','custom_app','oauth')`，不改 schema）；`store.scopes` 是 MySQL `JSON` 列，逗号分隔串会被自动编码成 JSON 数组字面量。
- 与 W1-STORE-02 的 `/oauth/callback`（store-add 流程）独立 —— saga 路径走 `/oauth/saga-callback`，互不影响。
- 不阻塞：dev 全程可走 mock 跑通整个 saga，无需真 Shopify Partner App；无新增 Flyway 迁移、无 schema 改动（saga ctx 已有 `storeId / shopDomain / shopAccessToken` 字段）。

---

## 20. W3-DS-03 跨公司授权过期提醒（实现完整化）

- V19 给 sys_data_scope 加 `expiring_notified_at` 列（dedupe 同一笔授权不重复提醒），并新增 `idx_data_scope_notify_window (cross_company, status, expires_at, expiring_notified_at)`。
- NotificationEventCode 已含 `CROSS_AUTH_EXPIRING`（W2 已落地，本次复用）。
- CrossAuthExpiryScheduler 真实实现（替换 W3-DS-01 骨架）：
  - `warnExpiring`（每小时整点）：扫 24h 内到期且 `expiring_notified_at IS NULL` → 调 `NotificationDispatcher.notifyUser`（钉钉 + 邮件） → 写 `expiring_notified_at=NOW()`
  - `hardExpire`（每天 00:05）：`status='ACTIVE' AND expires_at < NOW()` → REVOKED + revoked_at
- 不引入新 env（沿用 W3-DS-01 的 `RBAC_CROSS_AUTH_EXPIRY_WARN_CRON` / `RBAC_CROSS_AUTH_EXPIRE_CRON`）。
- 不改 CrossCompanyAuthController / DataScopeInterceptor；前端提醒通道走 W3-DS-02。

---

## 20. W3-PV-03 + W3-PV-06 预览主题（dev store 池）

| env | dev 默认 | 生产 |
|---|---|---|
| `PREVIEW_MAX_PER_DEV_STORE` | `3` | 同 |
| `PREVIEW_TTL_HOURS` | `24` | 同 |
| `PREVIEW_CLEANUP_CRON` | `0 */30 * * * *`（每 30 分钟整点） | 同 |

- V18 建 `preview_theme` 表（id / tenant_id / source_product_id / dev_store_id / shopify_theme_id / preview_url / status / last_accessed_at / expires_at / created_at / completed_at / error_message / deleted_at），按 `(dev_store_id,status,created_at)` / `(source_product_id,status)` / `(expires_at,status)` 三索引。
- `PreviewThemeAllocator`：tenant 内 partner-collab + ACTIVE 的 dev store，挑当前活跃 (PENDING/BUILDING/READY) preview_theme 行数最少且未达容量上限 (`PREVIEW_MAX_PER_DEV_STORE`) 的；都满则抛 `IllegalStateException("no available partner-collab dev store")`。
- `PreviewThemeCleanupScheduler` 每 30 分钟扫：(a) `expires_at < now` 且仍 PENDING/BUILDING/READY → 切 EXPIRED + 软删；(b) 同 dev store 活跃数 > 容量上限 → 按 created_at 升序删最老的几条。
- 新端点（无 RBAC 装饰，Wave 3 后续接入）：
  - `POST /preview` → `{tenantId, sourceProductId}` → 分配并返回 `PreviewTheme`（status=PENDING、shopify_theme_id/preview_url 为 null）
  - `GET /preview/{id}` → 单条
  - `GET /preview?sourceProductId=&devStoreId=&status=` → 列表
  - `POST /preview/{id}/accessed` → 用户点击预览链接时上报，刷新 `last_accessed_at`
- `shopify_theme_id` + `preview_url` 留 W3-PV-04（worker `/preview/build`）异步回填；本任务只做 DB 层分配 + 清理，不做 Shopify / R2 调用。

---

## 21. W3-TPL-02 模板 CRUD（无新增 env）

- 不引入新 env / 配置项。表 `base_template` / `base_template_version` 已在 V15（Day 1）落库；本任务仅补 service + controller + R2 zip 上传逻辑，无新增 Flyway。
- R2 zip 路径约定：`templates/{templateId}/versions/{version}/theme.zip`（写入由 `FileService.uploadBytes` 完成，桶用默认 `R2_BUCKET`）。
- 端点（全挂在 `/template`）：
  - `GET /template` → 分页列表，支持 `category` / `status` / `keyword` 过滤
  - `GET /template/{id}` → 模板详情 + 版本列表
  - `POST /template` → 新建（status=DRAFT）
  - `PUT /template/{id}` → 修改 name/description/category/coverImageR2Key
  - `POST /template/{id}/publish` → 发布（要求已设默认版本）— `@RequireSensitiveOp("TEMPLATE_PUBLISH")`
  - `POST /template/{id}/deprecate` → 弃用 — `@RequireSensitiveOp("TEMPLATE_DEPRECATE")`
  - `DELETE /template/{id}` → 软删（仅 DRAFT/DEPRECATED 可删）— `@RequireSensitiveOp("TEMPLATE_DELETE")`
  - `POST /template/{id}/version` → multipart 上传 zip（version + changelog + 可选 defaultReplaceRules JSON）— `@RequireSensitiveOp("TEMPLATE_VERSION_UPLOAD")`，zip 上限 100MB
  - `POST /template/{id}/default-version/{versionId}` → 把指定版本设为默认（同时把版本切 PUBLISHED）
- 版本上传时同 `(templateId, version)` 唯一；自动算 `zipBytes` + `zipSha256` 写库。
- PLATFORM_SUPER 角色限制目前为 `// TODO RBAC` 注释，待 W3-RBAC 落地后激活；现阶段任意已登录用户都可调（生产前需补）。
- 删除/发布/弃用/版本上传统一走 `@RequireSensitiveOp` 钉钉验证码二次确认（已有约定）。

---

## 22. W3-NEW-03 + W3-NEW-04 saga MEDIA + COLLECTIONS（无新增 env）

- 不引入新 env / 配置项；复用 `shopify.worker.base-url` + `shopify.worker.call-timeout-seconds`（已在 W2-SNAP-04 落地，dev 默认 `http://localhost:8765` / 120s）。
- Worker 新增端点：
  - `POST /push/files`：base64-encode R2 objects → Shopify GraphQL `fileCreate`；空 `r2_keys` 视为 no-op success。
  - `POST /push/collections`：逐个 REST `POST /custom_collections.json`；per-input `ShopifyAdminError` 落到 `error` 字段，不抛断整批。
  - 都遵循 `WORKER_DRY_RUN=true` → 合成 `gid://shopify/MediaImage/...` / `gid://shopify/Collection/...`，不调 Shopify / 不读 R2。
- Backend 新增 service / 端点：
  - `SagaMediaStepService.run(taskId)`：`executeStep(AUTH_DONE)` → 读 ctx.stepOutputs.mediaR2Keys → 调 worker → 把 `files` 写入 ctx.stepOutputs.media → advance 到 MEDIA。
  - `SagaCollectionsStepService.run(taskId)`：`executeStep(MEDIA)` → 读 ctx.stepOutputs.collections（缺省退回 `[{all},{new}]`）→ 调 worker → 把结果写入 ctx.stepOutputs.collections_created → advance 到 COLLECTIONS。
  - `SagaController` 新增 dev 手动入口：`POST /saga/{id}/step/run-media` + `POST /saga/{id}/step/run-collections`。生产由 saga orchestrator 在前一步完成回调里自动链。
- Java HttpClient 强制 `HTTP_1_1`（与 SnapshotGenerationService 一致），避免 uvicorn 拒绝 h2c upgrade 把 body 丢掉。

---

## 23. W3-PERF-01 Redis 缓存

| env | dev 默认 | 生产 |
|---|---|---|
| `CACHE_ENABLED` | `true` | `true`（开发可关掉用 `false` 验证 fallback）|
| `CACHE_DEFAULT_TTL_SECONDS` | `300`（5 分钟）| 同 dev，需观察 invalidate 命中率后再调 |

- 缓存 3 处（仅 backend-api，不动 worker / 前端）：
  - `StoreService.list(tenantId)` —— key `cache:store:list:{tenantId}`，仅当 `partnerCollab/devStore` 都为 null 时走缓存（带过滤参数直查 DB，避免 key 多维爆炸）
  - `ProductService.detail(productId)` —— key `cache:product:detail:{productId}`，DTO 是 `LinkedHashMap`（`product` + `variants` + `images`），没有 lazy 关联，直接 Jackson 序列化即可
  - 用户 → 权限：key `cache:rbac:user:{userId}:permissions` —— **本期未启用**。当前 `JwtAuthFilter` 仅注入静态 `ROLE_USER`，没有 per-request 的"user → permissions"重查询热点；`DataScopeInterceptor` 用内联子查询而不是先解析。等 W3-RBAC-04 把权限解析独立成方法后再开。
- Mutation 端主动 invalidate：
  - Store: `connectCustomApp` / `delete` / `setPartnerCollab` / `setDevStore` 提交后调 `cacheService.invalidate(CacheKeys.storeList(tenantId))`
  - Product: `update` / `delete` 后 invalidate `productDetail(id)`
- 实现走 `StringRedisTemplate` + 显式 `CacheService`（不用 Spring `@Cacheable`，避免 CGLIB self-invocation 失效）
- **Redis 不可用时自动降级**：`CacheService.getOrLoad` 抓住所有 Redis 异常，仅 `log.warn("[cache] read failed ...")` 然后回 loader 直查 DB；写回失败同样吞掉，不抛异常给业务层
- Micrometer counter（W2-MON-02 已经 expose 在 `/actuator/prometheus`）：
  - `shopifyhub_cache_hit_total{name="store_list|product_detail"}` 
  - `shopifyhub_cache_miss_total{name="store_list|product_detail"}`
  - 看板由 W2-MON-03 grafana provisioning 自带 placeholder，命中率公式 `hit / (hit + miss)`
- 失效策略：默认 TTL 兜底（5 分钟）+ mutation 主动失效双保险；`CacheService.invalidatePrefix` 留口子用 `KEYS`，仅适合 dev 排查，**生产应换 SCAN**

---

## 24. W3-NEW-05 + W3-NEW-09 saga PRODUCTS + 进度 SSE（无新增 env）

- 不引入新 env / 配置项；`SagaProgressService` 复用 `StringRedisTemplate`（已在 W2-AST-05 落地）。
- Saga PRODUCTS 步（`SagaProductsStepService`）：
  - 入口 `POST /saga/{taskId}/step/run-products` → `executeStep(COLLECTIONS, ...)` → 走 `PushService.pushBatch` 把 `ctx.productIdsToPush` 推到 `ctx.storeId`，BatchResult 写回 `ctx.stepOutputs.products`；成功后 advance 到 PRODUCTS。
  - 空 `productIdsToPush` → 仅 log + advance，写 `{skipped:true, reason:"no productIds"}`，不抛错（模板优先流程允许跳过）。
  - 全失败（success==0 && failed>0）→ throw → saga 落 FAILED at PRODUCTS，可通过 `/saga/{id}/retry` 复跑。
  - 部分失败 → 仍 advance；`push_conflict` 行已由 `PushService.push` 落库，由用户后续解决。
- 进度 SSE（`SagaProgressService` + `SagaProgressController`）：
  - 每 saga 一份 `CopyOnWriteArrayList<SseEmitter>`（in-mem map，按 taskId 分桶），1h emitter timeout。
  - 最近一条事件落 Redis `saga:progress:last:{taskId}` TTL 1h，迟订阅者一连上立即拿到最近一次状态（replay）。
  - `SagaService.start / advance / fail / retry` 通过 `@Lazy @Autowired SagaProgressService` 注入并发布事件：`started / advanced / failed / retried`，`@Lazy` 防潜在循环依赖。
  - 发布全程非阻塞：序列化失败、Redis 异常、emitter 写失败仅 `log.debug/warn`，绝不抛回 saga 状态机。
- `SecurityConfig` 把 `/saga/*/events` 加入 GET permitAll 列表（与 `/asset/snapshot/*/events` 同款），EventSource 无需 JWT。
- `SagaController` 新增 dev 入口 `POST /saga/{id}/step/run-products`；生产由 saga orchestrator 在 COLLECTIONS 完成后自动链。

---

## 25. W3-NEW-08 + W3-NEW-11 saga GUIDE 步 + 完成通知（无新增 env）

- 不引入新 env / 配置项；复用 `NotificationDispatcher` + `NotificationEventCode.NEW_STORE_SUCCESS / NEW_STORE_FAIL`（已存在常量）。
- Saga GUIDE 步（`SagaGuideStepService`）：
  - 入口 `POST /saga/{taskId}/step/run-guide` → `executeStep(PRODUCTS, ...)` → 收集 `guide_doc` 中 `show_in_saga_step='GUIDE' AND status='PUBLISHED'` 的行；按 `category, id` 排序。
  - 模板过滤规则：`ctx.templateId` 非空时，跳过 `relatedTemplateId` 不匹配且非 NULL 的行（`relatedTemplateId IS NULL` 视为通用，所有模板共享）；`ctx.templateId` 为空时全部包含。
  - 写回 `ctx.stepOutputs.guides`：`[{id, code, title, category, frontendUrl}]`，`frontendUrl` = `/guides/{id}`，前端 wizard 据此渲染"请阅读以下指南"链接面板。
  - 空集合是合法结果（无 GUIDE 文档配置）→ saga 仍 advance 到 THEME，不抛错。
- 完成通知（`SagaService.notifySagaSuccess / notifySagaFail`）：
  - `advance()` 在 `next == SUCCESS` 时调 `notifySagaSuccess(t, newCtx)`；`fail()` 在末尾调 `notifySagaFail(t, errorMessage)`。
  - `NotificationDispatcher` 通过 `@Autowired @Lazy` 字段注入（与 `SagaProgressService` 同款）防潜在循环依赖。
  - 发件全 try/catch，失败仅 `log.warn`，不影响 saga 状态机；`triggeredBy=null` 直接 skip。
  - SUCCESS 邮件正文：店铺域名 + 开店耗时（分钟，由 `Duration.between(startedAt, completedAt)` 算出）+ 详情链接 `/newstore/{id}`。
  - FAIL 邮件正文：失败步骤名 + 错误信息 + 重试入口提示。
  - 钉钉 `dingtalkUserid` 缺失时 `NotificationDispatcher` 自动降级到日志 + 邮件兜底（沿用 Wave 1 简化版逻辑，待 Wave 4 上 `notification_subscription` 订阅过滤）。
- `SagaController` 新增 dev 入口 `POST /saga/{id}/step/run-guide`；生产由 saga orchestrator 在 PRODUCTS 完成后自动链。

---

## 26. W3-NEW-06 + W3-NEW-07 主题 zip 安装 + 域名/品牌正则替换

| env | dev 默认 | 生产 |
|---|---|---|
| `SHOPIFY_THEME_PUBLISH_AFTER_INSTALL` | `false` | `false`（saga 装完留 unpublished，等用户在 wizard 审核后手动 publish；改 true 即装即发，慎用）|

- Worker `POST /push/theme`（`ThemePushService`）流程：
  1. 从 R2 拉模板版本的 `zip_r2_key`；
  2. 遍历 zip 内 text-like 文件（`.liquid/.json/.css/.js/.txt/.md/.yaml/.yml/.html/.svg`），按 `replace_rules` 应用替换。规则 key 以 `re:` 开头走 Python `re.sub` 正则，否则走字面量 `str.replace`；空 / null replacement 安全处理为空串；非 UTF-8 / 二进制 entry 原样透传；
  3. 仅当真正发生修改时把新 zip 上传到 R2 sibling key `<orig>.modified-<sha8>.zip`，否则复用源 key（省一次上传）；
  4. 拼 `R2_PUBLIC_BASE` + key 得到公网 URL，`ShopifyAdminClient.theme_create_from_src` 走 REST `POST /admin/api/{ver}/themes.json` body `{theme:{name, src, role:"unpublished"}}` —— Shopify 服务端拉取并解压；
  5. `publish=true` 时再调 `theme_publish` (`PUT /themes/{id}.json` body `{theme:{id, role:"main"}}`) 切 main；publish 失败仅 warn，theme 留 unpublished 不影响 saga 推进；
  6. dry-run 模式跳过 R2 + Shopify，返回合成 `shopify_theme_id` + `rules_applied_count = len(replace_rules)`。
- Backend `SagaThemeStepService`（`POST /saga/{id}/step/run-theme`，`executeStep(GUIDE, ...)`）：
  - 加载 `base_template` → `default_template_version_id` → `base_template_version`，校验 `zipR2Key` 非空；缺失 templateId / 版本 → 抛 `RuntimeException` 走 saga FAILED；缺失 templateId 视为模板可选，写 `{skipped:true}` 标记继续 advance；
  - 合并规则：`base_template_version.default_replace_rules_json` 解析后做基底，`ctx.replaceRules` 覆盖（ctx 优先）；JSON 解析失败仅 warn 不阻塞；
  - 调 worker `/push/theme` 复用 `SagaMediaStepService` 的 HTTP/1.1 强制客户端（避免 uvicorn 升级握手丢 body）；
  - 写回 `ctx.stepOutputs.theme = {shopify_theme_id, shopify_theme_role, modified_zip_r2_key, modified_zip_bytes, modified_zip_sha256, rules_applied_count, src_url, started_at, completed_at, dry_run}`；advance 到 PUBLISH。
- Worker 新增/扩展：
  - `app/clients/shopify_admin.py`：`_put` helper、`theme_create_from_src(name, src_url, role)`、`theme_publish(theme_id)`。
  - `app/services/theme_push.py`：`ThemePushService` + `ThemePushError`。
  - `app/routes/push.py`：`PushThemeRequest` + `POST /push/theme`，CLI 错 → 503，`ThemePushError` 默认 502（`shopify CLI:` 前缀的特例转 503），`ShopifyAdminError` → 502。
- 测试：`tests/test_theme_push.py` 6 例（dry-run / 文本替换 / 正则规则 / 无规则 passthrough 复用 R2 key / admin 错传播为 ThemePushError / publish 切 main）；总计 70 worker tests 全绿。
- dry-run 兜底：worker `WORKER_DRY_RUN=true` 不需 R2 zip 也不需 Shopify token，可在无凭据环境完成 saga 端到端冒烟。

## 27. W3-PERF-02 慢查询索引补全（无新增 env）

- Flyway V20 加 6 个热点索引，无配置变更
  - `product_price_history.idx_pricehist_store_product_changed (store_id, product_external_id, changed_at)`
  - `product_inventory_history.idx_invhist_store_product_changed (store_id, product_external_id, changed_at)`
  - `task.idx_task_type_id (type, id)`
  - `product_snapshot.idx_snapshot_store_status_created (store_id, status, created_at)`
  - `store_product.idx_storeprod_tenant_status_updated (tenant_id, status, updated_at)`
  - `user_invitation.idx_invitation_status_invited (status, invited_at)`
- 详细分析（每条索引对应的具体热查询、EXPLAIN 命中证据）见 `性能优化复盘.md`
- 不引入新 env / 配置项 / 新依赖
- `sys_audit_log` / `preview_theme` / `sys_data_scope` 经分析现有索引已覆盖，本次未补
