# 资产同步 Wave 3 规划（Defer 项）

> **配套文档**：`店铺资产同步与跨店迁移-评估.md`（v0.1 评估稿）
> **当前状态**：Wave 1（AS1 同步链路 / AS2 CAS / AS6 模板版本 UI）+ Wave 2（AS3 资产覆盖 / AS4 跨店 Diff / AS5 推送替换）+ AS6.5 zip 上传修复 + 4 个 TODO 收尾，全部已 merge 到 main（commit `5dd6787` 推到 origin）。
> **本文档**：把 v1 留下的 defer 项和 v1.1 的待补功能拆成 Wave 3 的 Track，可分轮次启动。
> **总估时**：~21 PD，建议分 3 轮（3a / 3b / 3c），每轮独立可启停。

---

## 1. 命名约定

延续 `AS{n}` 体系：
- **AS7-x** = Wave 3a（用户可见的功能补齐）
- **AS8-x** = Wave 3b（性能 / 稳定性）
- **AS9-x** = Wave 3c（运维 / 可观测 / 边缘）

Flyway 版本预留：当前最新 V40。Wave 3 预留 V41–V44，按下表分配。**启动前必须查 `并行任务编排.md` 是否被其他 Track 占用。**

---

## 2. Wave 3a · 用户可见功能补齐（~7 PD）

> 可大幅并行，4 个 Track 互不重叠文件。这一波是运营 / 业务用户最先抱怨的缺口。

### AS7-1 · 推送前替换规则 dry-run 预览（~3 PD）
**对应**：评估文档 §7 R5。
**问题**：当前 `ReplaceEngine` 在 push 时直接套规则、推到 Shopify。如果规则误伤（如 `body_html` 里碰巧包含 brandName 字符串），用户**事后**才发现。
**目标**：push dialog 提交前显示替换前/后 diff，用户确认后才真推。

**交付清单**：
- 后端 `PushController` 加 `POST /push/preview` endpoint：接 `{productId, storeId, templateVersionOverrideId?}`，返回不写库的 `{rules, previewDiffs: [{field, before, after, hits}], wouldPush: payload}`
- 抽 `PushService.buildProductPayload` 为纯函数（不写 task 行），让 preview / push 共用
- 前端 `PushTriggerDialog` / `BatchPushTriggerDialog` 加"预览替换"按钮 → 弹 modal 显示 unified diff（复用 AS4 diff 渲染组件）
- 用户在预览里 confirm → submit；不 confirm 直接 close

**验收**：
- 选好店铺 + override 后点"预览"→ 1s 内看到 body_html / seo / metafield 三段的替换 diff
- 命中 0 次的字段 collapse 默认折叠
- 推 100 个产品（批量）只预览第一个 + 显示"另 99 个产品规则相同"

**依赖**：AS4 已 merge（diff 渲染组件可复用）。

---

### AS7-2 · 历史快照对比页（~1 PD）
**对应**：评估文档 §3 AS4 留的 TODO（同店两快照 diff 入口未做）。
**问题**：AS4 只做了"跨店"diff（两个店各取 latest）。同店历史快照对比是"重新同步后看变了什么"的刚需，但页面没建。

**交付清单**：
- 新页面 `app/(authed)/snapshots/[storeId]/history/page.tsx`：
  - 顶部下拉两个 snapshotId（限定 store_id 内的 SUCCESS 快照）
  - 默认 A=最新、B=次新
  - 调 `diffApi.diffManifest(a, b)` → 复用 AS4 的 diff 树视图
- 店铺详情页加跳转入口（"历史对比" tab 或按钮）
- i18n 加 `diff.history.*` keys

**验收**：
- 任意一店选两个 SUCCESS 快照，30s 内出 diff 树（命中缓存 < 1s）
- 选同一个 snapshot 双边 → "manifests are identical"

**依赖**：AS4 引擎本身已支持任意两 snapshot id；只缺前端入口。

---

### AS7-3 · 模板绑定集中管理页（~2 PD）
**对应**：评估文档 §3 AS5 留的 TODO（"模板绑定管理页"留 TODO，时间紧就跳过 — 跳过了）。
**问题**：当前 store_template_binding 只能通过 PushDialog 间接看 / 改，运营要批量调整时很难。

**交付清单**：
- 新页面 `app/(authed)/store-template-bindings/page.tsx`：
  - 表格列：店铺名 / domain / 当前绑定 (template + version + 创建时间) / 自定义规则数 / 操作
  - 顶部搜索 + 状态过滤（已绑定 / 未绑定）
  - 行内"修改"打开 modal：选择 template_version + 编辑 custom_replace_rules_json
  - 行内"解绑"二次确认
- sidebar"资产"分组加入口
- i18n 加 `storeTemplateBindings.*` keys
- 后端无改动（AS5 已有 PUT /store-template-binding/{storeId} / DELETE）

**验收**：
- 50 家店一页内可见 / 可批量切版本
- 改完后回到 PushDialog 立即生效（同一 binding API）

**依赖**：AS5 已 merge（API 已就位）。

---

### AS7-4 · `product.template_suffix` CSV 导入支持（~1 PD）
**对应**：评估文档 §7 R6 + #7 收尾留的 UX 缺口（UI 入口已有，但批量导产品时还得逐个手编）。

**交付清单**：
- `frontend-admin/app/(authed)/products/import/page.tsx` CSV 模板加 `template_suffix` 列（可选）
- 后端 `ProductImportService`（如不存在则在 `ProductService` 加方法）解析该列，写入 `product.template_suffix`
- 文档 / 模板说明加 hint："留空走默认 product.liquid；如 'landing' 则用 product.landing.liquid"

**验收**：
- 导入 1000 行 CSV 含 template_suffix 列 → DB 全部正确写入
- 缺列时 fallback null（与 UI 行为一致）

**依赖**：AS5 V40 已加列。

---

## 3. Wave 3b · 性能 / 稳定性（~10 PD）

> 接入第二家大店（10w+ products / 主题数百文件）就会暴露。Wave 3a 跑通后立即启动。
> 这一波**不可大幅并行** — AS8-1 / AS8-2 都改 SyncConsumer 同步链路核心。

### AS8-1 · PRODUCT-level metafields 分批拉取（~3 PD）
**对应**：评估文档 §3 AS3-03 + AS3 agent 留的 TODO（worker `metafields_pull.py` 注释里）。
**问题**：当前 `/pull/metafields` 只拉 shop-level；产品级 metafields 在大店有数十万条，per-product GraphQL 串行会跑数小时。

**交付清单**：
- worker `metafields_pull.py` 加产品级流：用 GraphQL **bulk operation**（`bulkOperationRunQuery` + 轮询 + 下载 JSONL）
- 一份大 JSONL → 切分按 product_external_id 落 CAS（每个产品一份 metafields 子文件）
- backend `SyncConsumer` 把 product-level metafields 加进 FULL 流程的 metafields 段
- 单测：bulk operation flow（mock Shopify 返回 JSONL URL）

**验收**：
- 1w product / 平均 5 metafield 的店 → 30 min 内完成 product metafields 同步（vs 当前 per-product 串行需 6 小时+）
- 失败可重试（bulk operation API 有完整生命周期，不能丢）

**依赖**：AS3 已 merge；要求 Shopify Admin scopes 含 `read_products` + `read_product_metafields`。

---

### AS8-2 · 大店全量同步断点续传（~5 PD）
**对应**：评估文档 §7 R1。
**问题**：当前 SyncConsumer 串行调 5 个 pull endpoint，任一失败 → PARTIAL，重试要从头开始。大店主题 + product 加起来 30 min+，断网就白干。

**交付清单**：
- V41 ALTER `asset_snapshot` 加 `progress_json TEXT`（记录每段 endpoint 完成情况：`{theme: SUCCESS, product: RUNNING_AT_OFFSET_2000, files: PENDING, ...}`）
- worker pull endpoints 接受 `resume_token` 参数（从指定 offset / cursor 继续）
- backend SyncConsumer 改造：每段开始前查 progress；命中已 SUCCESS 跳过；命中 RUNNING_AT_OFFSET_X 用该 token 续传
- 前端店铺详情页"重新同步"按钮文案改"恢复同步"（如果 latest snapshot 是 PARTIAL/RUNNING）

**验收**：
- 拉到 product offset=5000 时 kill worker → 重启后 resync 从 5000 继续不重头
- product 已 SUCCESS、files 失败 → resync 只重跑 files

**依赖**：AS3 已 merge（5 个 pull endpoint）；可与 AS8-1 顺序做（AS8-1 先把 product metafields 接通再考虑断点续传它）。

---

### AS8-3 · 多店并发同步限流（~2 PD）
**对应**：评估文档 §7 R2。
**问题**：worker 当前没限流。10 家店同时接入会触发 Shopify Admin API 全局限流（REST 2 req/s，GraphQL 50 cost/s），互相阻塞。

**交付清单**：
- worker `app/clients/shopify_admin.py` 加 per-shop token bucket（用 `asyncio.Semaphore` 或简单时间戳记录）
- backend `SyncConsumer` 限并发：跨 store 最多 3 并发（用 RabbitMQ prefetch 或 ThreadPoolExecutor 限制）
- 配置项：`shopify.admin-api.per-shop-rps` / `asset.sync.max-concurrent-stores`，application.yml 文档化

**验收**：
- 同时接 5 家店 → 5 个 FULL snapshot 串行/部分并发跑，单店速率不超 Shopify 限流；不出现 429
- 单店内 GraphQL bulk operation + REST 调用混用时不互相阻塞

**依赖**：AS1 + AS3 已 merge。

---

## 4. Wave 3c · 运维 / 可观测 / 边缘（~3 PD，全并行）

### AS9-1 · `task.replace_rule_hits` 专属列（~1 PD）
**对应**：评估文档 #5 + AS5 PushService 注释里的 TODO。
**问题**：当前 ruleHits 写 `task.payload_json`，运营想看"哪条规则没命中过 / 哪条命中最多"得 grep payload，无法走 SQL 聚合。

**交付清单**：
- V41（如 AS8-2 占了就改 V42）`ALTER TABLE task ADD COLUMN replace_rule_hits_json JSON NULL`
- `Task` entity 加字段
- `PushService` 改写：把 ruleHits 同时塞 task 列（不再仅 payload_json）
- 任务详情页前端展示 hits 直方图（小 chart）

**验收**：
- 推 100 次产品 → SQL 聚合 `SELECT key, SUM(...) FROM task WHERE replace_rule_hits_json IS NOT NULL GROUP BY key` 一条出
- 任务详情页显示规则命中数

**依赖**：AS5 已 merge。

---

### AS9-2 · CAS 老数据回填脚本（~1 PD）
**对应**：评估文档 §7 R3 + AS2 `cas_storage.py` 注释里的 TODO。
**触发条件**：dev / staging 接了几家真店、积累 ≥ 100GB `r2_key` 路径数据后启动。

**交付清单**：
- 一次性 Python 脚本 `bin/cas-backfill.py`：
  - 扫 `asset_file WHERE blob_sha256 IS NULL`
  - 每行：HEAD 旧 `r2_key` → 下载 → sha256 → PUT 到 CAS path（命中跳过）→ UPDATE `blob_sha256` + `asset_blob.ref_count++`
  - 进度日志 + 可中断恢复（按 id 排序）
- `ops/runbook` 加一节"CAS 回填操作"
- 不删旧 `r2_key`（保留兜底，等下个 sprint 评估清理）

**验收**：
- 跑完 dev 数据：所有 `asset_file.blob_sha256` 非空；R2 总存储下降（重复文件去重）
- 中断后续跑不重做已完成的行

**依赖**：AS2 已 merge。

---

### AS9-3 · saga `triggeredBy` 透传 + 模板版本 zip 重传（~1 PD）
**两个边缘修补合并一个 Track。**

#### 9-3a · saga triggeredBy
**对应**：TODO #8 收尾时留下 — saga 路径调 `publishStoreConnected(s, null)`，缺操作人审计追踪。

**交付**：
- saga task 表（`saga_task` 或类似）已有 created_by 列（如无，V42 加列）
- `SagaAuthService` 把 `ctx.createdBy` 传给 `publishStoreConnected`

#### 9-3b · 模板版本同 (templateId, version) 重传 zip
**对应**：AS6.5 实现的 `POST /template/{id}/version` 拒绝重复 version。但运维有时需要"同 version 重传 zip"（比如发现包损坏）。

**交付**：
- backend `PUT /template/{id}/version/{versionId}/zip`（multipart）：替换 `zip_r2_key` + `zipBytes` + `zipSha256`，要求钉钉敏感码二次确认
- 前端模板详情页加"重传 zip"按钮
- 不动 default_replace_rules_json / changelog（要改它们走 AS6 PUT /base-template-version/{id}）

**验收**：
- 上传错的 zip 后能重传修正，sha256 / size 一并更新
- 删除旧 R2 key（避免遗留垃圾）

---

## 5. Wave 3 推荐执行顺序

```
Wave 3a (~7 PD, 可并行 4 Track)
  ├─ AS7-1 dry-run 预览
  ├─ AS7-2 历史快照对比
  ├─ AS7-3 模板绑定管理页
  └─ AS7-4 CSV template_suffix
              ↓
Wave 3b (~10 PD, 顺序)
  ├─ AS8-1 PRODUCT metafields
  ├─ AS8-2 断点续传        ← 强串行（改同步链路核心）
  └─ AS8-3 多店限流
              ↓
Wave 3c (~3 PD, 全并行)
  ├─ AS9-1 ruleHits 列
  ├─ AS9-2 CAS 回填
  └─ AS9-3 saga triggeredBy + zip 重传
```

**触发条件**：
- 3a：用户开始抱怨"推错了"或"不知道改了什么"或"批量改 binding 麻烦" → 立即启
- 3b：第一家大店（10w+ products）接入后 → 立即启（不做 3b 跑不完全量）
- 3c：规模化运维（≥ 10 家店持续运行）后 → 按需启

---

## 6. 不做（reject 列表）

明确**不**做的事，避免下次有人提：

| 项 | 为什么不做 |
|---|---|
| 自动同步定时刷新（每天 3am 全量同步所有店）| Shopify webhook 已覆盖增量；全量同步耗时长，dev 需求时手动 resync 即可 |
| pull 路径回写本地 `product_metafield` 表 | 评估文档 R8 已澄清 — pull 落 R2 是快照，本地表是 push 源；混在一起会引入 sync conflict |
| 跨租户 diff（多租户对比）| AS4 已显式拒绝 — CAS key 按 tenant 隔离；跨租户对比要走"导出 JSON 后人工比"路径，不在产品内做 |
| `zip_r2_key` 改 NULL 允许 | AS6.5 已选定"模板版本 = 必带 zip"语义；UI 强制 multipart 即可 |
| 替换规则换正则引擎 | AS5 ReplaceEngine 已选定 literal 替换，避免误伤；如果用户真要正则可在自定义规则里加单独的 `pattern` 字段（v2 评估） |

---

## 7. Flyway 版本预留

| 版本 | 用途 | 所属 Track |
|---|---|---|
| V41 | `asset_snapshot.progress_json` | AS8-2（断点续传）|
| V42 | `task.replace_rule_hits_json` | AS9-1 |
| V43 | `saga_task.created_by`（如未存在）| AS9-3a |
| V44 | 预留 | — |

> 启动前查 `并行任务编排.md` 是否已被其他 Track 占用。

---

## 8. 待评审决策点（启动前需答）

1. **AS8-2 断点续传**：恢复点是按 file 粒度还是按 endpoint 粒度？（细粒度准但实现复杂；粗粒度简单但浪费）→ 倾向 endpoint 粒度（每段最多重做一段）
2. **AS9-2 CAS 回填**：什么时机跑？（dev 现在跑会清掉测试数据；prod 跑要排维护窗）→ 倾向 dev/staging 各跑一次验证脚本，prod 等首次大同步前
3. **AS7-1 dry-run**：批量推送的预览要不要 100 个产品都展示？（页面会卡）→ 只展示第一个 + "其余 N 个规则相同"
4. **AS8-3 限流参数**：per-shop-rps 默认值？→ 倾向 1.5 req/s（Shopify 给 2，留余量）

---

> **最后**：本规划是 v0.1 草稿。Wave 3a 启动前需 review + 把 AS7-1 ~ AS9-3 的 owner 落到 `并行任务编排.md`，并把 V41–V44 占用同步登记。
