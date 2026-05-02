# 生产 Shopify App 申请清单（W4-RLS-01）

> 编写：2026-05-03
> 适用：从 Shopify Custom App 切到 Public App + Partner 分发审核

## 1. Partner Account 准备

- [ ] 在 https://partners.shopify.com 注册 Partner Organization（公司主体）
- [ ] 完成 Partner 身份验证（DBA name + 真实地址 + 联系人）
- [ ] 主账号 + 至少 1 个 owner 备份账号（防主账号离职锁库）
- [ ] 启用 Partner 双因子（手机或 TOTP）

## 2. App 创建（Public App）

在 Partner Dashboard → Apps → "Create app":

- [ ] **App Type**: Public app（不要选 Custom，否则不能多店分发）
- [ ] **App name**: `Biou Shopify Hub`（或品牌定义；80 字符内，不含 Shopify/My Shopify 关键字）
- [ ] **App URL**:  `https://app.shopifyhub.biounetwork.com/` （生产域名）
- [ ] **Allowed redirection URLs**（至少 2 条）：
  - `https://app.shopifyhub.biounetwork.com/api/oauth/shopify/callback`
  - `https://app.shopifyhub.biounetwork.com/oauth/shopify/callback`（前端兜底）
- [ ] 复制 `Client ID` + `Client secret` → 写入 `.env` 的 `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`
- [ ] **重要**：开发测试期间也可以共用 Custom App key，但生产**必须**切到 Public App key（额度、scope 范围、流量限制都不同）

## 3. App Scopes（必须）

在 App configuration → API access:

- `read_products` `write_products`
- `read_inventory` `write_inventory`
- `read_themes` `write_themes`
- `read_files` `write_files`
- `read_orders`（如未来要拉订单数据）
- `read_locales` `read_translations`（多语言）
- `read_online_store_pages` `write_online_store_pages`（policies / menu）
- `read_collections` `write_collections`

注：scopes 一旦在 OAuth flow 中要求过，更换需要 merchant 重新授权 — 一次性把要的全要了。

## 4. Webhooks 注册

- `products/update` → `https://app.shopifyhub.biounetwork.com/api/webhook/products/update`
- `products/delete` → 同前缀 `/api/webhook/products/delete`
- `app/uninstalled` → 同前缀 `/api/webhook/app/uninstalled`
- `shop/redact` `customers/redact` `customers/data_request`（GDPR 强制三件套）

每个 webhook 要：
- [ ] HMAC 校验（`SHOPIFY_API_SECRET` 算 SHA-256）
- [ ] 5 秒内 ACK 200，重活进 RabbitMQ

## 5. App Distribution（分发设置）

- [ ] App listing 准备：
  - Icon (1024×1024 PNG)
  - 5 张截图 (1600×900)
  - English short / long description
  - 中文 short / long description（应用市场支持双语）
  - Demo video（可选，> 60% 的审核要求）
- [ ] Pricing：免费 / Subscription / Usage-based — 当前阶段先 free + 邀请制
- [ ] Privacy policy URL: `https://app.shopifyhub.biounetwork.com/privacy`
- [ ] Support contact: 钉钉群 + email

## 6. 上线前检查

- [ ] `.env` 切换：`SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SHOPIFY_APP_HOST`
- [ ] OAuth flow 用 Partner 的 development store 跑一遍（end-to-end）
- [ ] 验证 webhook 事件能落 RabbitMQ + 后端处理日志正常
- [ ] 验证一键开店 saga 能在 partner dev store 跑通（`bin/e2e-saga.sh` 指向 production）
- [ ] 拉一份 demo store 的 theme + product → 推一次 → 验证

## 7. 提交审核

- [ ] App listing → "Submit for review"
- [ ] Shopify 团队 5-10 工作日内反馈
- [ ] 常见 reject 原因：webhook ack 超时 / scope 不匹配实际功能 / OAuth 安装错误处理 / GDPR 三件套未实现 / pricing 不清晰

## 8. 上线后监控

- [ ] Grafana：Shopify rate-limit 仪表板（X-Shopify-Shop-Api-Call-Limit / Bucket）
- [ ] 钉钉告警：`PRODUCT_PUSH_FAIL` `THEME_PUSH_FAIL` 24h 内任意触发
- [ ] Linear / GitHub issue：作为初期 1.0 stability bug 收集渠道

## 9. 卡点 / 待用户操作

- ⏳ 域名 `app.shopifyhub.biounetwork.com` 解析 + Cloudflare WAF + SSL
- ⏳ 隐私政策中文版（W4-RLS-02 配合输出）
- ⏳ Partner 主体公司主页 / Logo 提交至 Cloudflare 备案
- ⏳ Shopify dev store 申请（用主账号免费创建即可）

---

_最后更新：2026-05-03（W4-RLS-01 初版）_
