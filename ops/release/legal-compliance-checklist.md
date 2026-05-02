# 法务 / 合规材料清单（W4-RLS-02）

> 编写：2026-05-03
> 范围：数据出境（R-8）+ Shopify Public App 隐私要求 + 钉钉企业开放平台 + 国内个人信息保护
> Owner：法务 + 数据安全 + 产品

---

## 1. 数据出境（R-8 主线）

### 1.1 数据流梳理

| 数据类型 | 出境（境外存储） | 入境 | 处理活动 | 法律基础 |
|---|---|---|---|---|
| 商品图片 / 主题资产 | Cloudflare R2（全球边缘） | Shopify 拉取 | 缓存 / 推送 | 商品交付必要 |
| Shopify access_token | 本地 RDS（境内）+ 加密 | 调用 Shopify API | 商品同步 | 业务必要 |
| 钉钉 unionId / userId | 本地 RDS（境内） | 钉钉同步 | 登录 / 通知 | 雇主合法权益 |
| 审计日志 | R2（境外） | 不入境 | 安全合规存档 | 安全审计必要 |
| 备份 dump | R2（境外，加密） | 灾备拉回 | 灾备 | 业务连续性 |
| 用户邮箱 | 本地 RDS（境内）+ Resend / SMTP | 出境（邮件投递） | 邀请 / 重置 | 服务履行 |

**结论**：审计 / 备份 / 资产 涉及出境；用户身份信息全部境内。

### 1.2 R-8 备案准备（个人信息出境标准合同）

- [ ] PIPL 第 38 条：通过中央网信办认证 OR 标准合同 OR 个人单独同意
- [ ] 选**标准合同备案**（中央网信办 2023 年颁布，模板下载：http://www.cac.gov.cn）
- [ ] 内容：
  - 出境主体：本公司主体（中国境内法人）
  - 接收方：Cloudflare Inc.（美国）
  - 数据类型：审计日志（不含直接 PII 但含 user_id）+ 备份 dump（含 PII，AES-256-GCM 加密）+ 商品资产（不含 PII）
  - 加密：AES-256-GCM @ rest；TLS 1.3 in transit
  - 主体权利：访问 / 删除 / 撤回同意 — 走 backend `/profile` 接口
- [ ] 签署 + 提交省级网信办（公司注册地）
- [ ] 提交后 10 工作日通过 = 完成备案

### 1.3 隐私政策（中英双语）

- [ ] `/privacy` 路由（Next.js Public route，layout 与 login 一致）
- [ ] 内容必须涵盖：
  1. 收集哪些个人信息
  2. 如何使用 / 共享（特别是 Shopify / 钉钉 / Cloudflare 三方）
  3. 出境告知 + 接收方 + 法律基础
  4. 主体权利清单（PIPL）
  5. 联系方式（DPO / 投诉邮箱）
  6. cookie 政策（最小化使用）
- [ ] 用户在登录页 + 注册页**显式勾选同意**（非默认勾选）
- [ ] 政策版本号 + 更新日期

## 2. Shopify Public App 合规要求

- [ ] **GDPR 三件套** webhook 实现：
  - `customers/data_request`：商家收到顾客的 data subject access request 时，Shopify 转发给 app
  - `customers/redact`：顾客 30 天前注销，app 必须 30 天内删该顾客数据
  - `shop/redact`：商家卸载 app 48 小时后，必须删该 shop 所有数据
- [ ] App listing 隐私政策 URL 与 `/privacy` 一致
- [ ] Cookie 不要 set 给 shopify.com 子域；本系统 cookie 仅为自身域

## 3. 钉钉企业开放平台合规

- [ ] 钉钉 ISV 协议 / 个人信息保护协议签署（首次创建时阅读）
- [ ] 数据使用：sys_user.dingtalk_userid + dingtalk_unionid 仅用于登录 / 通知，不外传
- [ ] 离职冷冻 90 天 + 删除：W1-AUD-02 + W4-OPS-03 已实现

## 4. 安全 / 信息保护

- [ ] **凭证生命周期**：
  - JWT secret rotation 半年一次（手动）
  - Shopify access_token 30 天前自动告警续期
  - 钉钉 access_token 7000s 自动刷新
  - R2 access key 季度 rotate
- [ ] **审计**：
  - 所有 POST/PUT/DELETE 写 sys_audit_log（W1-AUD-01 + W4-OPS-01）
  - 月归档保留 7 年（合规留存最低要求）
- [ ] **访问控制**：
  - 跳板机白名单 IP（节点 A/B/C 直接 SSH 仅跳板机）
  - WireGuard 内网隔离
  - 生产 RDS 仅监听内网

## 5. ICP / 备案（如域名是 .com 也可不做；.cn 必须）

- [x] 当前域名 `biounetwork.com` 是 .com，国际域名，不强制 ICP
- [ ] 但若用户访问加速 + 国内 CDN，需要 ICP 备案
- [ ] 走 Cloudflare 中国接入（合作伙伴：网宿）需要 ICP

## 6. 上线前必备文档清单

- [ ] 隐私政策 v1（中英双语）
- [ ] 用户协议 / 服务条款
- [ ] 数据处理协议（DPA，与 Cloudflare / 钉钉 签）
- [ ] R-8 标准合同备案回执
- [ ] 安全应急响应预案（事故 24h 内通报）
- [ ] 数据删除 / 修改 / 导出 SOP（合规请求处理流程）

## 7. 待用户决策

- ⏳ 选择 R-8 备案路径：标准合同 vs 中央网信办认证（前者快，后者权威）
- ⏳ 是否走 ICP 备案（决定能否用境内 CDN）
- ⏳ DPO（数据保护官）人选确认

---

_最后更新：2026-05-03（W4-RLS-02 初版）_
