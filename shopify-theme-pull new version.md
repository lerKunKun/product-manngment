# Shopify Theme & Media Pull

通用技能：为指定 Shopify 商店完成「安装授权 → 拉主题 JSON → 下载所有媒体文件」全流程。
支持多商店，token 自动管理（安装、缓存、静默刷新）。

---

## 调用方式

```
/shopify-theme-pull <store-domain> [选项]
/shopify-theme-pull --setup <store-domain>     ← 首次安装授权
/shopify-theme-pull --list                     ← 查看已配置商店
```

**选项：**
- `--setup <store>`：首次为商店安装 App 并储存 token（每个店铺只需跑一次）
- `--list`：列出所有已配置商店及 token 状态
- `--theme <名称或ID>`：指定主题，省略则列出让用户选
- `--json <glob>`：只处理匹配的 JSON，默认 `templates/*.json sections/*.json`
- `--out <目录>`：媒体输出目录，默认当前目录下 `downloaded_media/`

---

## Token 配置文件

路径：`C:\Users\Administrator\.claude\shopify-stores.json`

```json
{
  "stores": {
    "example.myshopify.com": {
      "clientId": "7e9cb568cfd431c538f36d1ad3f2b4f6",
      "accessToken": "shpat_xxx",
      "refreshToken": "shprt_xxx",
      "expiresAt": "2026-04-28T08:00:00.000Z",
      "scopes": ["read_files", "read_themes"],
      "tokenType": "cli"
    },
    "another-store.myshopify.com": {
      "accessToken": "shpat_yyy",
      "scopes": ["read_files", "read_themes"],
      "tokenType": "custom_app"
    }
  }
}
```

`tokenType` 两种值：
- `cli`：通过 `shopify store auth` 获取，有 refreshToken，access 24h 过期但可静默刷新
- `custom_app`：Shopify Admin 手动创建的 Custom App token，永不过期

---

## 执行步骤

---

### 特殊指令：`--list`

读取配置文件，打印表格：

```
商店域名                      tokenType    状态          scopes
nyx3tr-yu.myshopify.com      cli          有效(剩3h)    read_files,read_themes
another-store.myshopify.com  custom_app   永久有效       read_files
```

token 值只显示前8位 + `****`，完成后退出。

---

### 特殊指令：`--setup <store>`

**用途**：首次为一个商店安装 App 并储存 token，只需执行一次。

**步骤：**

**1. 检查 Shopify CLI**
```bash
shopify version
```
不存在则安装：`npm install -g @shopify/cli @shopify/theme`

**2. 账号登录**
```bash
shopify auth login
```
若 CLI 已有登录 session 则跳过（通过 `shopify theme list` 是否成功判断）。
若需要登录，提示用户：「即将打开浏览器登录 Shopify 账号，请完成后返回。」

**3. 安装 App 并获取 token**

运行：
```bash
shopify store auth --store <STORE> --scopes read_files,read_themes
```

提示用户：
「即将打开浏览器授权商店访问。
这会在商店中安装 **shopify-cli-connector-app**（Shopify 官方出品，免费，只读权限）。
每个商店只需安装一次，后续自动刷新 token 无需浏览器。」

**4. 读取并保存 token**

命令完成后，从 CLI 配置文件读取 token：

```python
import json, os, re

cli_config_path = os.path.join(
    os.environ["APPDATA"],
    "shopify-cli-store-nodejs", "Config", "config.json"
)
cli_config = json.load(open(cli_config_path, encoding="utf-8"))

# 找到对应商店的 session
store_prefix = store.replace(".myshopify.com", "")
token_data = None
for key, val in cli_config.items():
    if store_prefix in key:
        sessions = val.get("myshopify", {}).get("com", {}).get("sessionsByUserId", {})
        for uid, session in sessions.items():
            token_data = {
                "clientId":     session["clientId"],
                "accessToken":  session["accessToken"],
                "refreshToken": session["refreshToken"],
                "expiresAt":    session["expiresAt"],
                "scopes":       session["scopes"],
                "tokenType":    "cli"
            }
```

**5. 验证 token**

```python
import urllib.request
req = urllib.request.Request(
    f"https://{store}/admin/api/2024-10/shop.json",
    headers={"X-Shopify-Access-Token": token_data["accessToken"]}
)
with urllib.request.urlopen(req, timeout=10) as r:
    shop = json.loads(r.read())["shop"]
    print(f"验证成功：{shop['name']}")
```

**6. 写入配置文件**

```python
config_path = r"C:\Users\Administrator\.claude\shopify-stores.json"
try:
    config = json.load(open(config_path, encoding="utf-8"))
except:
    config = {"stores": {}}

config["stores"][store] = token_data
json.dump(config, open(config_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"token 已保存到 {config_path}")
```

**7. 完成提示**
```
========================================
  商店: <STORE_NAME> (<STORE>)
  App:  shopify-cli-connector-app 已安装
  Token 有效期: 至 <expiresAt>
  后续刷新: 自动静默刷新，无需浏览器
  配置文件: C:\Users\Administrator\.claude\shopify-stores.json
========================================
下次直接运行：/shopify-theme-pull <STORE>
```

---

### STEP 1 — 收集参数

解析 `store-domain`，若未提供询问用户。

---

### STEP 2 — 获取有效 Token

**按优先级尝试，取第一个成功的：**

#### 方式 A：读配置文件中的 custom_app token（永久有效）

```python
config = json.load(open(r"C:\Users\Administrator\.claude\shopify-stores.json", encoding="utf-8"))
entry = config["stores"].get(store, {})
if entry.get("tokenType") == "custom_app":
    token = entry["accessToken"]
    # 直接验证可用性
```

打印：「使用永久 Custom App token」，跳到 STEP 3。

#### 方式 B：读配置文件中的 cli token，检查是否过期

```python
from datetime import datetime, timezone
expires_at = datetime.fromisoformat(entry["expiresAt"].replace("Z", "+00:00"))
now = datetime.now(timezone.utc)
if now < expires_at:
    token = entry["accessToken"]
    print(f"使用缓存 token（剩余 {int((expires_at-now).seconds/3600)}h）")
```

若未过期，跳到 STEP 3。

#### 方式 C：token 过期 → 用 CLI 静默刷新

token 过期时，CLI 内部会用 refreshToken 自动换新 token（无需浏览器）：

```bash
shopify store execute \
  --store <STORE> \
  --query "query { shop { name } }" \
  --json
```

CLI 执行此命令时，若 accessToken 过期，会自动用 refreshToken 换取新 token 并更新本地配置文件。
命令完成后，重新读取 CLI 配置文件，获取新 token，并更新 `shopify-stores.json`：

```python
# 重新读取 CLI 配置文件（CLI 已自动刷新写入）
cli_config = json.load(open(cli_config_path, encoding="utf-8"))
# ... 同 --setup 步骤4 的读取逻辑 ...
config["stores"][store].update(new_token_data)
json.dump(config, open(config_path, "w", ...), ...)
print("token 已静默刷新并更新配置文件")
```

打印：「token 已静默刷新（无需浏览器）」

#### 方式 D：兜底 → 引导用户重新授权

若以上均失败（refreshToken 也过期，极少见），提示：
「token 需要重新授权，运行以下命令完成一次浏览器登录：
  /shopify-theme-pull --setup <STORE>
（此后将再次自动管理，无需频繁授权）」
然后退出，等用户执行 `--setup`。

---

### STEP 3 — 拉取主题 JSON 文件

列出主题：
```bash
shopify theme list --store <STORE> --json
```

若未指定 `--theme`，打印列表让用户选择（显示 ID / 名称 / role）。

执行拉取：
```bash
shopify theme pull \
  --store <STORE> \
  --theme <THEME_ID> \
  --only "templates/*.json" \
  --only "sections/*.json" \
  --only "config/settings_data.json" \
  --nodelete \
  --path <WORK_DIR>
```

打印：「已拉取 X 个 JSON 文件」

---

### STEP 4 — 扫描媒体引用

对当前目录所有 `.json` 文件提取：
```python
import re, glob

PATTERNS = [
    (r'shopify://files/videos/([^"\']+)', "VIDEO"),
    (r'shopify://shop_images/([^"\']+)',  "IMAGE"),
    (r'shopify://files/([^"\']+\.(?:jpg|jpeg|png|webp|gif|svg))', "IMAGE"),
]

videos, images = set(), set()
for f in glob.glob("**/*.json", recursive=True):
    text = open(f, encoding="utf-8").read()
    for pat, typ in PATTERNS:
        for m in re.finditer(pat, text):
            (videos if typ == "VIDEO" else images).add(m.group(1))

print(f"找到 {len(videos)} 个视频引用，{len(images)} 个图片引用")
```

---

### STEP 5 — 查询 CDN URL（Admin API GraphQL 直连）

使用 STEP 2 中获取的 token，Python `urllib` 直接调用，不走 CLI subprocess。

**视频**（分页，每页 50，翻完所有页）：
```graphql
query($cursor: String) {
  files(first: 50, after: $cursor, query: "media_type:VIDEO") {
    nodes {
      ... on Video { filename fileStatus sources { url mimeType } }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```
取最高分辨率 mp4（URL 中 `(\d+)p` 最大值）。

**图片**（分页，每页 50）：
```graphql
query($cursor: String) {
  files(first: 50, after: $cursor, query: "media_type:IMAGE") {
    nodes {
      ... on MediaImage { fileStatus image { url } }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```
从 CDN URL 末尾路径段提取文件名（去掉 `?` 后的参数）做匹配键。

打印：「匹配 X/Y 个视频，X/Y 个图片」，列出未匹配文件名。

---

### STEP 6 — 批量下载

```
<OUT_DIR>/
  videos/   ← mp4
  images/   ← jpg/png/webp/gif
```

- 已存在且 size > 0 → 跳过
- 显示进度：`文件名  45%  9MB/20MB`
- 失败继续，最后汇总

---

### STEP 7 — 汇总报告

```
========================================
  商店:   <NAME> (<STORE>)
  主题:   <THEME_NAME> (ID: <ID>)
  Token:  cli 自动刷新 / custom_app 永久
  输出:   <OUT_DIR>
----------------------------------------
  JSON:   X 个文件
  视频:   X 成功 / X 跳过 / X 失败 / X 未找到
  图片:   X 成功 / X 跳过 / X 失败 / X 未找到
  大小:   X MB
========================================
```

---

## Windows 注意事项

- Shopify CLI 路径：`where shopify` 获取（通常 `C:\nvm4w\nodejs\shopify.cmd`），subprocess 用绝对路径 + `shell=True`
- GraphQL 查询通过 Python urllib 直连 API，不通过 CLI subprocess
- 控制台输出只用 ASCII，避免 GBK 乱码
- 配置文件：`C:\Users\Administrator\.claude\shopify-stores.json`
- CLI token 缓存：`%APPDATA%\shopify-cli-store-nodejs\Config\config.json`
