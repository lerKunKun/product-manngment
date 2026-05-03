# 并行改进编排（Sprint 9）

> 编排：2026-05-03
> 用途：i18n v3 扩 5 页 + jacoco 覆盖率 + 生产部署文档 + Mock Shopify 测试基础
> 风险控制：4 track 全为低风险扩展，无主代码业务逻辑改动

---

## 0. Track 划分

| Track | 内容 | 工时 | 主要文件 |
|---|---|---|---|
| **T34** | i18n v3：messages 扩到 ~250 key + 5 高频页 t() 化（products/stores/inbox/profile/orgs） | ~2.5 PD | messages.ts + 5 页 page.tsx |
| **T35** | jacoco 测试覆盖率 plugin + HTML 报告 + ci 上传 artifact | ~1.5 PD | pom.xml + .github/workflows/ci.yml |
| **T36** | 生产部署 step-by-step（节点 A/B/C + 跳板机 + Cloudflare Tunnel + WireGuard） | ~2.5 PD | ops/deploy/README.md（新建） + ops/bootstrap 引用 |
| **T37** | Mock Shopify 测试（WireMock + ShopifyApiClient + StoreControllerTest 真测） | ~2.5 PD | backend pom.xml + 新 test 文件 |

**总工时**：~9 PD（4 人并行约 1 周）

---

## 1. 文件 Ownership

| 文件 | Owner |
|---|---|
| `frontend-admin/lib/i18n/messages.ts` | T34（扩展） |
| `frontend-admin/app/(authed)/products/page.tsx` | T34（仅 t() 化文案） |
| `frontend-admin/app/(authed)/stores/page.tsx` | T34 |
| `frontend-admin/app/(authed)/inbox/page.tsx` | T34 |
| `frontend-admin/app/(authed)/profile/page.tsx` | T34 |
| `frontend-admin/app/(authed)/orgs/page.tsx` | T34 |
| `backend-api/pom.xml` | T35（jacoco plugin） + T37（WireMock dep） |
| `.github/workflows/ci.yml` | T35（jacoco artifact upload） |
| `ops/deploy/README.md`（新建） | T36 |
| `ops/deploy/cloudflare-tunnel.md`（新建） | T36 |
| `ops/deploy/wireguard.md`（新建） | T36 |
| `backend-api/src/test/java/com/biou/shopifyhub/store/ShopifyApiClientTest.java` | T37 |
| `backend-api/src/test/java/com/biou/shopifyhub/store/StoreControllerWireMockTest.java` | T37 |

T35 + T37 都改 pom.xml — T35 owns jacoco section；T37 owns wiremock test dep。**两 track 各自加自己的 dep，互不重叠**。合并时检查 pom.xml 不要 conflict。

---

## 2. T34 详细任务（i18n v3 扩 5 页）

### 2.1 messages.ts 扩到 ~250 key

新增 namespace（每 namespace × zh + en）：

```ts
// products.* (~25 key)
"products.title": "产品库",
"products.search": "搜索",
"products.searchPlaceholder": "标题 / handle / SKU",
"products.create": "+ 新建产品",
"products.import": "导入",
"products.export": "导出",
"products.batch.publish": "批量上架",
"products.batch.draft": "批量改草稿",
"products.batch.archive": "批量归档",
"products.batch.delete": "批量删除",
"products.column.id": "ID",
"products.column.handle": "handle",
"products.column.title": "标题",
"products.column.vendor": "vendor",
"products.column.status": "状态",
"products.column.created": "创建",
"products.status.active": "上架",
"products.status.draft": "草稿",
"products.status.archived": "已归档",
"products.empty": "暂无产品",
"products.confirmDelete": "确认删除选中 {count} 个产品？此操作需钉钉验证码",

// stores.* (~15 key)
"stores.title": "店铺管理",
"stores.create": "+ 添加店铺",
"stores.healthCheck": "健康检查",
"stores.healthy": "店铺正常",
"stores.unhealthy": "店铺异常",
"stores.batch.pullAssets": "批量拉资产",
"stores.batch.disable": "批量禁用",
"stores.column.domain": "店铺域名",
"stores.column.brand": "品牌",
"stores.column.tokenType": "Token 类型",
"stores.column.tokenExpiry": "过期时间",
"stores.column.devStore": "Dev",
"stores.empty": "暂无店铺",

// inbox.* (扩展 T30 已有 ~10 key 至 ~18)
"inbox.markRead": "标已读",
"inbox.linkOpen": "打开链接",
"inbox.category.invitation": "邀请",
"inbox.category.store": "店铺",
"inbox.category.push": "推送",
"inbox.category.approval": "审批",
"inbox.category.ops": "运维",
"inbox.category.system": "系统",

// profile.* (~15 key)
"profile.title": "个人中心",
"profile.basic": "基本信息",
"profile.username": "用户名",
"profile.employeeNo": "工号",
"profile.email": "邮箱",
"profile.userType": "账号类型",
"profile.userType.staff": "正式员工",
"profile.userType.temp": "临时账号",
"profile.dingtalkBound": "钉钉已绑定",
"profile.dingtalkNotBound": "钉钉未绑定",
"profile.changePassword": "修改密码",
"profile.oldPassword": "原密码",
"profile.newPassword": "新密码（≥ 8 位）",
"profile.confirmPassword": "确认新密码",
"profile.notificationSubscriptions": "通知订阅",
"profile.notificationSubscriptions.save": "保存订阅",

// orgs.* (~12 key)
"orgs.title": "组织管理",
"orgs.expandAll": "展开全部",
"orgs.collapseAll": "折叠全部",
"orgs.createTopLevel": "+ 新建顶级",
"orgs.createChild": "新建子部门",
"orgs.rename": "重命名",
"orgs.dingSynced": "钉钉同步",
"orgs.dingSyncedTip": "钉钉同步部门，请先在钉钉调整",
"orgs.detail": "组织详情",
"orgs.selectNodeHint": "选中左侧节点查看详情",
"orgs.confirmDelete": "删除组织 #{id}？需要钉钉验证码二次确认。",
"orgs.deleted": "#{id} 已删除",
```

**英文翻译**：自然意译，保持简洁；术语对齐 Shopify / DingTalk 标准（store / handle / SKU 等保持原样）。

### 2.2 5 页 t() 化

不动业务逻辑（T20/T21/T23 等），仅替换硬编码中文。

#### products (`app/(authed)/products/page.tsx`)
- 标题 / 搜索 placeholder / 状态过滤 / 批量按钮 / 表头 / 空状态 / 确认删除文案
- 不动 T21 virtualizer + T23 useQuery + T20 a11y

#### stores (`app/(authed)/stores/page.tsx`)
- 标题 / 健康检查 toast / 批量操作 menu items / 表头 / 空状态
- 不动 T9 健康检查 + T23 useQuery + T9 批量操作

#### inbox (`app/(authed)/inbox/page.tsx`)
- 时间分组 header（已有 T30 部分）/ category 过滤选项 / mark-all-read button / linkUrl button
- 不动 T12 业务逻辑

#### profile (`app/(authed)/profile/page.tsx`)
- 基本信息字段 label / 修改密码 form labels / 订阅 section title / 保存按钮
- 不动 T2 通知订阅矩阵的内部业务

#### orgs (`app/(authed)/orgs/page.tsx`)
- 顶部 toolbar / 树标识 / 详情区 label / 操作按钮 / 钉钉 tooltip
- 不动 T6 树形渲染 + 钉钉同步标识保护

### 2.3 typecheck

```
cd frontend-admin && pnpm tsc --noEmit
```

### 不要碰
- T35 / T36 / T37 范围
- 后端
- 业务逻辑

### 输出
1. messages.ts 总 key 数（~250 expected）
2. 5 页改造概述（每页改了多少处）
3. tsc 结果

---

## 3. T35 详细任务（jacoco 测试覆盖率）

### 3.1 加 jacoco plugin 到 pom.xml

**修改** `backend-api/pom.xml`

在 `<build><plugins>` 内加：

```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.12</version>
  <executions>
    <execution>
      <id>prepare-agent</id>
      <goals>
        <goal>prepare-agent</goal>
      </goals>
    </execution>
    <execution>
      <id>report</id>
      <phase>test</phase>
      <goals>
        <goal>report</goal>
      </goals>
    </execution>
  </executions>
  <configuration>
    <excludes>
      <exclude>**/Application.class</exclude>
      <exclude>**/entity/**</exclude>
      <exclude>**/dto/**</exclude>
      <exclude>**/config/**</exclude>
    </excludes>
  </configuration>
</plugin>
```

### 3.2 验证生成报告

```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH \
  mvn test -Dtest='ApprovalEngineTest,InappServiceTest'  # 跑 2 个 case 验证
```

应生成 `target/site/jacoco/index.html` + `target/jacoco.exec`。

如 mvn test 因 dev mysql 不可用失败，至少 jacoco plugin 配置正确（mvn test-compile + mvn jacoco:prepare-agent 应不报错）。

### 3.3 ci.yml 加 jacoco artifact upload

**修改** `.github/workflows/ci.yml`

在 backend job 末尾加 step（如 backend job 跑 test）：

```yaml
- name: Upload jacoco report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: jacoco-report
    path: backend-api/target/site/jacoco/
    retention-days: 30
```

如 backend job 当前不跑 mvn test（仅 compile），新增一步：

```yaml
- name: Run tests with jacoco
  run: cd backend-api && mvn -B test -DfailOnError=false || true
  continue-on-error: true
```

允许测试失败但不 block CI（首次试点）；jacoco 报告仍上传。

### 3.4 README 加引用

在 README「安全审计」section 之上加：

```markdown
## 测试覆盖率

跑后端测试 + 生成 jacoco HTML 报告：

```bash
cd backend-api && mvn test
open target/site/jacoco/index.html
```

CI 自动跑测试 + 上传 jacoco artifact 30 天。

当前覆盖：~31 个 case 横跨 Approval / Inapp / NotificationLog / SysAuditLog / SysRole / BackupNotify。
首次基准：~30%（含 entity 排除后）；目标 v1.0 达 60%。
```

### 不要碰
- T34 / T36 / T37 范围
- 业务代码 / 测试代码

### 输出
1. pom.xml jacoco plugin 配置
2. mvn test 跑结果（含 jacoco 报告生成）
3. ci.yml artifact 配置
4. README 改动

---

## 4. T36 详细任务（生产部署文档）

### 4.1 ops/deploy/README.md 总览

**新建** `ops/deploy/README.md`

包含：
- 部署架构图（节点 A/B/C 角色 + 跳板机 + Cloudflare）
- 网络拓扑图（WireGuard mesh + 公网入口）
- 部署顺序总览（先节点 A → C → B → 跳板机）
- 各节点 server 规格 + 软件版本（mysql 8 / redis 8 / rabbitmq 4 / java 21 / python 3.12 / nginx 1.27 / docker 27）
- 常用命令（启停应用 / 查日志 / 重建 / 回滚）

### 4.2 节点 A 部署 step-by-step

包含：
1. 服务器初始化（用 `ops/bootstrap/01-install-docker.sh` + `02-init-system.sh`）
2. WireGuard 配置（节点 A 是 mesh 一员）
3. RDS 安装（mysql 8.0 + 主从配置 + binlog 开 + my.cnf 推荐）
4. Redis 安装（带 AUTH + 持久化 RDB）
5. RabbitMQ 安装（独立 vhost + admin user + 监控插件）
6. backend-api systemd unit
7. asset-worker systemd unit（如部署在节点 A）
8. R2 凭证 + .env 配置
9. cron 安装（rds-backup.sh / audit-purge.sh / 健康自检）
10. 防火墙规则（仅跳板机 SSH + 节点 C scrape）

### 4.3 节点 B 部署（asset-worker）

`ops/deploy/node-b-asset-worker.md`：
- WireGuard 配置（与节点 A/C 互通）
- Python 3.12 + uvicorn 启动
- Shopify CLI / R2 SDK
- 仅暴露给节点 A backend-api（不暴露公网）
- systemd unit

如需要可合并到 README.md（按需拆分）

### 4.4 节点 C 部署（监控 + Cloudflare Tunnel）

包含：
- Prometheus + Grafana + Loki + Alertmanager docker-compose（已有 ops/monitoring/）
- node-exporter scrape 节点 A/B
- Cloudflare Tunnel 配置（让外网访问 grafana 走 cloudflare access）
- Trivy / blackbox-exporter / cloudwatch-exporter 接入

新建 `ops/deploy/cloudflare-tunnel.md`：
- 在 Cloudflare dashboard 创建 tunnel
- 安装 cloudflared
- 配置 ingress（grafana.biounetwork.com → localhost:3001）
- Cloudflare Access policy（仅特定 email / Google Workspace 可访问）

### 4.5 跳板机 + WireGuard

新建 `ops/deploy/wireguard.md`：
- 安装 wireguard
- 生成 keys（每节点）
- 配 mesh 拓扑（节点 A ↔ B ↔ C ↔ 跳板机）
- 启 systemd
- 验证连通性

### 4.6 不动现有 ops/release 文档

`ops/release/` 已有 wave4-regression / shopify-app-checklist / legal-compliance 三个文档。T36 仅新增 ops/deploy/，不动 release 区。

### 不要碰
- T34 / T35 / T37 范围
- ops/release/* 现有
- ops/monitoring 现有
- ops/backup 现有

### 输出
1. 新建文件清单（ops/deploy/README.md + cloudflare-tunnel.md + wireguard.md 等）
2. 部署顺序总览（A → C → B → 跳板机）
3. 各节点最低 server 规格 + 软件版本
4. 常见问题（FAQ）3-5 个

---

## 5. T37 详细任务（Mock Shopify 测试）

### 5.1 加 WireMock 依赖

**修改** `backend-api/pom.xml`

在 `<dependencies>` 加（`<scope>test</scope>`）：

```xml
<dependency>
  <groupId>com.github.tomakehurst</groupId>
  <artifactId>wiremock-jre8-standalone</artifactId>
  <version>3.0.1</version>
  <scope>test</scope>
</dependency>
```

或更新版本（`org.wiremock:wiremock-standalone:3.10.0` 等，按 Maven Central 实际）。

### 5.2 ShopifyApiClientTest

**新建** `backend-api/src/test/java/com/biou/shopifyhub/store/ShopifyApiClientTest.java`

`@SpringBootTest` + WireMockServer：

```java
@SpringBootTest
@ActiveProfiles("test")
class ShopifyApiClientTest {
    static WireMockServer wireMock;

    @Autowired ShopifyApiClient client;

    @BeforeAll static void setUp() {
        wireMock = new WireMockServer(WireMockConfiguration.wireMockConfig().dynamicPort());
        wireMock.start();
    }

    @AfterAll static void tearDown() {
        wireMock.stop();
    }

    @Test void fetchShopDetail_success() {
        // stub Shopify shop.json response
        wireMock.stubFor(get(urlEqualTo("/admin/api/2024-10/shop.json"))
            .withHeader("X-Shopify-Access-Token", equalTo("test-token"))
            .willReturn(aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("""
                    {"shop": {"name":"Test Store","plan_name":"basic","domain":"test.myshopify.com"}}
                    """)));
        
        // 临时 stub host (替代 *.myshopify.com 调用)
        // 实际 ShopifyApiClient 用 https://{shop}/... — 需要重写为可注入 base URL
        // 如不能：跳过此测试 + 报告说明需要 client 重构
        
        String shopDomain = "localhost:" + wireMock.port();  // 假设 client 接受任意 host
        ShopifyApiClient.ShopDetail detail = client.fetchShopDetail(shopDomain, "test-token");
        assertTrue(detail.ok());
        assertEquals("Test Store", detail.name());
        assertEquals("basic", detail.planName());
    }

    @Test void fetchShopDetail_401_returns_error() {
        // 同样 stub 但返 401
    }

    @Test void fetchShopDetail_timeout() {
        // 用 wireMock 加 fixedDelay > client timeout
    }
}
```

**重要**：现有 ShopifyApiClient.java 可能写死 `https://{shopDomain}/admin/...` URL — 不接受 host 替换为 localhost:port。**此情况下**：
- 选项 1: 重构 client 加 base URL 注入（@Value("${shopify.api-base-url:https://}")）
- 选项 2: 用 `Mockito.spy` 部分 mock
- 选项 3: 测试代码用反射改 client 内部 HttpClient
- **简化版**: 跳过这个测试，仅写「TODO 等 client 加 base URL 注入后开启」+ commented out 测试代码

按实际情况选；优先选项 1（小重构 + 真测试）；如代码改动大则选项 3（commented + TODO）。

### 5.3 StoreControllerWireMockTest

**新建** `backend-api/src/test/java/com/biou/shopifyhub/store/StoreControllerWireMockTest.java`

测试 `GET /store/{id}/test`：
- mock 一个 store 行（用 H2 / @Transactional 插一行 + token）
- mock Shopify shop.json 200 → 期望 `healthy: true`
- mock 401 → 期望 `healthy: false, reason: HTTP 401`
- mock timeout → 期望 `healthy: false, reason: ...timeout`

如 ShopifyApiClient 不能注入 base URL，**fallback** 同上。

### 5.4 编译验证

```
cd backend-api && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH mvn -DskipTests test-compile
```

必须 SUCCESS。

如 WireMock dep 装不上，**fallback** 用 mockwebserver (okhttp3) — 一般 spring boot 项目自带。

### 不要碰
- T34 / T35 / T36 范围
- src/main/java（除非 ShopifyApiClient 需小重构加 base URL）
- 业务测试

### 输出
1. WireMock dep 加在 pom.xml 哪里
2. 新建测试文件 + 用例数
3. ShopifyApiClient 是否需要加 base URL 注入（决定测试可行性）
4. mvn test-compile 结果

---

## 6. 启动检查表

每 track 完工时输出：
1. 创建/修改文件清单
2. compile / tsc / mvn test 结果
3. 已知 fallback / TODO

合并后我做：
- backend mvn compile + frontend tsc 全量验证
- pom.xml 合并冲突检查（T35 + T37）
- git commit + push

---

_最后更新：2026-05-03_
