-- ============================================
-- V28: 全库表 + 字段中文 COMMENT
-- 作用：给所有表 + 所有列补中文说明，方便后端开发与 DBA 查表理解字段语义
-- 注意：MODIFY COLUMN 会完整重写列定义，本文件以 V1..V26 中 CREATE/ALTER 的最终定义为准，
--       逐字保留原列类型 + 修饰符（NOT NULL / DEFAULT / ON UPDATE / ENUM 取值 / UNSIGNED 等），
--       仅追加 COMMENT。AUTO_INCREMENT / PRIMARY KEY 通过 NOT NULL AUTO_INCREMENT 保留。
--       本迁移不动索引，不动数据。
-- ============================================

SET NAMES utf8mb4;

-- ===================================================================
-- V1: sys_user 用户主表
-- ===================================================================
ALTER TABLE sys_user COMMENT = '用户主表：平台所有人员（钉钉同步 + 邮件邀请的临时账号）';

ALTER TABLE sys_user MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_user MODIFY COLUMN employee_no VARCHAR(32) NOT NULL COMMENT '员工编号：jobNumber 优先；为空则 EMP000001 自增；TEMP 用 TMP000001';
ALTER TABLE sys_user MODIFY COLUMN username VARCHAR(64) NOT NULL COMMENT '登录用户名（全局唯一）';
ALTER TABLE sys_user MODIFY COLUMN password_hash VARCHAR(128) COMMENT '密码哈希（BCrypt cost=12）';
ALTER TABLE sys_user MODIFY COLUMN password_must_change TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否强制下次登录改密：0=否 / 1=是';
ALTER TABLE sys_user MODIFY COLUMN email VARCHAR(128) COMMENT '邮箱';
ALTER TABLE sys_user MODIFY COLUMN phone VARCHAR(32) COMMENT '手机号';
ALTER TABLE sys_user MODIFY COLUMN dingtalk_unionid VARCHAR(64) COMMENT '钉钉 unionId（跨企业唯一）';
ALTER TABLE sys_user MODIFY COLUMN dingtalk_userid VARCHAR(64) COMMENT '钉钉 userId（企业内唯一）';
ALTER TABLE sys_user MODIFY COLUMN dingtalk_corp_id VARCHAR(64) COMMENT '钉钉 corpId（来源企业）';
ALTER TABLE sys_user MODIFY COLUMN default_tenant_id BIGINT COMMENT '默认租户 sys_tenant.id（登录后默认进入的租户）';
ALTER TABLE sys_user MODIFY COLUMN user_type ENUM('STAFF','TEMP') NOT NULL DEFAULT 'STAFF' COMMENT '用户类型：STAFF=钉钉来源正式员工 / TEMP=邮件邀请的临时员工';
ALTER TABLE sys_user MODIFY COLUMN expires_at TIMESTAMP NULL COMMENT '账号到期时间（仅 TEMP 必填，最长 90 天）';
ALTER TABLE sys_user MODIFY COLUMN status ENUM('ACTIVE','FROZEN','DELETED','EXPIRED') NOT NULL DEFAULT 'ACTIVE' COMMENT '账号状态：ACTIVE=正常 / FROZEN=离职冷冻30天 / DELETED=已删除 / EXPIRED=临时账号到期';
ALTER TABLE sys_user MODIFY COLUMN frozen_at TIMESTAMP NULL COMMENT '冷冻开始时间';
ALTER TABLE sys_user MODIFY COLUMN expired_at TIMESTAMP NULL COMMENT '实际过期时间（status 切到 EXPIRED 的时刻）';
ALTER TABLE sys_user MODIFY COLUMN invited_by BIGINT NULL COMMENT '仅 TEMP：邀请人 sys_user.id';
ALTER TABLE sys_user MODIFY COLUMN invitation_id BIGINT NULL COMMENT '仅 TEMP：关联 user_invitation.id';
ALTER TABLE sys_user MODIFY COLUMN last_login_at TIMESTAMP NULL COMMENT '最近一次登录时间';
ALTER TABLE sys_user MODIFY COLUMN last_login_ip VARCHAR(64) COMMENT '最近一次登录 IP';
ALTER TABLE sys_user MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE sys_user MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE sys_user MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';
-- V26 追加列
ALTER TABLE sys_user MODIFY COLUMN avatar_url VARCHAR(512) NULL COMMENT '头像 URL（钉钉同步或自上传）';
ALTER TABLE sys_user MODIFY COLUMN position VARCHAR(64) NULL COMMENT '职位/岗位';

-- ===================================================================
-- V1: sys_org 组织树
-- ===================================================================
ALTER TABLE sys_org COMMENT = '组织树：分公司（COMPANY）与部门（DEPT）共表，物化路径';

ALTER TABLE sys_org MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_org MODIFY COLUMN parent_id BIGINT NULL COMMENT '父节点 sys_org.id（COMPANY 节点为 NULL）';
ALTER TABLE sys_org MODIFY COLUMN type ENUM('COMPANY','DEPT') NOT NULL COMMENT '节点类型：COMPANY=分公司（租户根） / DEPT=部门';
ALTER TABLE sys_org MODIFY COLUMN name VARCHAR(128) NOT NULL COMMENT '组织名称';
ALTER TABLE sys_org MODIFY COLUMN code VARCHAR(64) NOT NULL COMMENT '组织编码（COMPANY 节点为分公司简称如 hy/bj，全局唯一）';
ALTER TABLE sys_org MODIFY COLUMN tenant_id BIGINT NULL COMMENT '所属租户 sys_tenant.id（COMPANY 节点对应 tenant_xx；DEPT 继承父）';
ALTER TABLE sys_org MODIFY COLUMN path VARCHAR(512) NOT NULL DEFAULT '/' COMMENT '物化路径，如 /1/3/12/';
ALTER TABLE sys_org MODIFY COLUMN dingtalk_dept_id VARCHAR(64) COMMENT '钉钉部门 id';
ALTER TABLE sys_org MODIFY COLUMN dingtalk_corp_id VARCHAR(64) COMMENT '钉钉 corpId';
ALTER TABLE sys_org MODIFY COLUMN sort INT NOT NULL DEFAULT 0 COMMENT '同级排序值';
ALTER TABLE sys_org MODIFY COLUMN status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：ACTIVE=启用 / DISABLED=禁用';
ALTER TABLE sys_org MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE sys_org MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE sys_org MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V1: sys_role 角色
-- ===================================================================
ALTER TABLE sys_role COMMENT = '角色定义表（RBAC）';

ALTER TABLE sys_role MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_role MODIFY COLUMN code VARCHAR(64) NOT NULL COMMENT '角色编码（全局唯一），如 PLATFORM_SUPER / COMPANY_ADMIN';
ALTER TABLE sys_role MODIFY COLUMN name VARCHAR(128) NOT NULL COMMENT '角色名称';
ALTER TABLE sys_role MODIFY COLUMN scope ENUM('PLATFORM','TENANT','DEPT') NOT NULL COMMENT '作用域：PLATFORM=平台级 / TENANT=租户级 / DEPT=部门级';
ALTER TABLE sys_role MODIFY COLUMN description VARCHAR(255) COMMENT '角色描述';
ALTER TABLE sys_role MODIFY COLUMN builtin TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否内置角色：0=自定义 / 1=内置（不可删）';
ALTER TABLE sys_role MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE sys_role MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- ===================================================================
-- V1: sys_permission 权限点
-- ===================================================================
ALTER TABLE sys_permission COMMENT = '权限点表（菜单/按钮/API 三类）';

ALTER TABLE sys_permission MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_permission MODIFY COLUMN code VARCHAR(128) NOT NULL COMMENT '权限码（全局唯一），形如 PRODUCT:READ';
ALTER TABLE sys_permission MODIFY COLUMN resource VARCHAR(64) COMMENT '资源标识，如 product / store';
ALTER TABLE sys_permission MODIFY COLUMN action VARCHAR(64) COMMENT '动作标识，如 read / write / delete';
ALTER TABLE sys_permission MODIFY COLUMN name VARCHAR(128) COMMENT '权限名称';
ALTER TABLE sys_permission MODIFY COLUMN parent_id BIGINT NULL COMMENT '父权限 sys_permission.id（菜单树用）';
ALTER TABLE sys_permission MODIFY COLUMN type ENUM('MENU','BUTTON','API') NOT NULL COMMENT '权限类型：MENU=菜单 / BUTTON=按钮 / API=接口';
ALTER TABLE sys_permission MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V1: sys_role_permission 角色-权限关联
-- ===================================================================
ALTER TABLE sys_role_permission COMMENT = '角色-权限关联表';

ALTER TABLE sys_role_permission MODIFY COLUMN role_id BIGINT NOT NULL COMMENT '角色 sys_role.id';
ALTER TABLE sys_role_permission MODIFY COLUMN permission_id BIGINT NOT NULL COMMENT '权限 sys_permission.id';

-- ===================================================================
-- V1: sys_user_role 用户-角色关联
-- ===================================================================
ALTER TABLE sys_user_role COMMENT = '用户-角色关联表（角色可绑定到具体组织节点）';

ALTER TABLE sys_user_role MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_user_role MODIFY COLUMN user_id BIGINT NOT NULL COMMENT '用户 sys_user.id';
ALTER TABLE sys_user_role MODIFY COLUMN role_id BIGINT NOT NULL COMMENT '角色 sys_role.id';
ALTER TABLE sys_user_role MODIFY COLUMN org_id BIGINT NULL COMMENT '组织 sys_org.id（角色绑定到具体节点）';
ALTER TABLE sys_user_role MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V1 + V16 + V19: sys_data_scope 显式数据授权
-- ===================================================================
ALTER TABLE sys_data_scope COMMENT = '显式数据授权表（跨公司授权 / 邀请来源附带授权）';

ALTER TABLE sys_data_scope MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_data_scope MODIFY COLUMN user_id BIGINT NOT NULL COMMENT '被授权用户 sys_user.id';
ALTER TABLE sys_data_scope MODIFY COLUMN scope_type ENUM('STORE','COMPANY','PRODUCT') NOT NULL COMMENT '范围类型：STORE=店铺 / COMPANY=公司 / PRODUCT=产品';
ALTER TABLE sys_data_scope MODIFY COLUMN scope_id BIGINT NOT NULL COMMENT '范围对象 id（按 scope_type 解释）';
ALTER TABLE sys_data_scope MODIFY COLUMN access ENUM('READ','WRITE') NOT NULL COMMENT '访问级别：READ=只读 / WRITE=可写';
ALTER TABLE sys_data_scope MODIFY COLUMN granted_by BIGINT NOT NULL COMMENT '授权人 sys_user.id';
-- V16 新增列：granter_company_id（位于 granted_by 之后）
ALTER TABLE sys_data_scope MODIFY COLUMN granter_company_id BIGINT NULL DEFAULT NULL COMMENT '授权人所在公司 sys_org.id（跨公司授权用）';
ALTER TABLE sys_data_scope MODIFY COLUMN granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授权时间';
ALTER TABLE sys_data_scope MODIFY COLUMN expires_at TIMESTAMP NOT NULL COMMENT '过期时间（必填）';
-- V16 新增列：revoked_at（位于 expires_at 之后）
ALTER TABLE sys_data_scope MODIFY COLUMN revoked_at TIMESTAMP NULL DEFAULT NULL COMMENT '撤销时间（NULL=未撤销）';
-- V19 新增列：expiring_notified_at（位于 revoked_at 之后）
ALTER TABLE sys_data_scope MODIFY COLUMN expiring_notified_at TIMESTAMP NULL DEFAULT NULL COMMENT '24h 到期前提醒时间（dedupe 用）';
ALTER TABLE sys_data_scope MODIFY COLUMN approval_id BIGINT NULL COMMENT '关联审批流 approval_flow.id';
-- V16 把 source 枚举扩到含 APPROVAL
ALTER TABLE sys_data_scope MODIFY COLUMN source ENUM('CROSS_AUTH','INVITATION','APPROVAL') NOT NULL DEFAULT 'CROSS_AUTH' COMMENT '来源：CROSS_AUTH=跨公司授权 / INVITATION=邀请附带 / APPROVAL=审批通过';
-- V16 新增列：cross_company（位于 source 之后）
ALTER TABLE sys_data_scope MODIFY COLUMN cross_company TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否跨公司授权：0=否 / 1=是';
ALTER TABLE sys_data_scope MODIFY COLUMN status ENUM('ACTIVE','EXPIRING','EXPIRED','REVOKED') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：ACTIVE=有效 / EXPIRING=即将到期 / EXPIRED=已过期 / REVOKED=已撤销';
ALTER TABLE sys_data_scope MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V1: user_invitation 临时员工邮件邀请
-- ===================================================================
ALTER TABLE user_invitation COMMENT = '临时员工邮件邀请表';

ALTER TABLE user_invitation MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE user_invitation MODIFY COLUMN email VARCHAR(128) NOT NULL COMMENT '受邀人邮箱';
ALTER TABLE user_invitation MODIFY COLUMN target_company_id BIGINT NOT NULL COMMENT '目标分公司 sys_org.id（COMPANY 节点）';
ALTER TABLE user_invitation MODIFY COLUMN target_dept_id BIGINT NULL COMMENT '目标部门 sys_org.id（DEPT 节点；可选）';
ALTER TABLE user_invitation MODIFY COLUMN role_codes JSON NOT NULL COMMENT '邀请时分配的角色 code 列表';
ALTER TABLE user_invitation MODIFY COLUMN data_scopes JSON NOT NULL COMMENT '邀请时分配的数据范围列表';
ALTER TABLE user_invitation MODIFY COLUMN account_expires_at TIMESTAMP NOT NULL COMMENT '临时账号到期时间（必填，最长 90 天）';
ALTER TABLE user_invitation MODIFY COLUMN invitation_token VARCHAR(64) NOT NULL COMMENT '邀请链接 token（全局唯一）';
ALTER TABLE user_invitation MODIFY COLUMN link_expires_at TIMESTAMP NOT NULL COMMENT '邀请链接过期时间（48h 有效）';
ALTER TABLE user_invitation MODIFY COLUMN initial_password_hash VARCHAR(128) NOT NULL COMMENT '初始密码哈希';
ALTER TABLE user_invitation MODIFY COLUMN status ENUM('PENDING','ACCEPTED','LINK_EXPIRED','REVOKED') NOT NULL DEFAULT 'PENDING' COMMENT '邀请状态：PENDING=待激活 / ACCEPTED=已激活 / LINK_EXPIRED=链接过期 / REVOKED=已撤销';
ALTER TABLE user_invitation MODIFY COLUMN invited_by BIGINT NOT NULL COMMENT '邀请人 sys_user.id';
ALTER TABLE user_invitation MODIFY COLUMN invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '邀请时间';
ALTER TABLE user_invitation MODIFY COLUMN accepted_at TIMESTAMP NULL COMMENT '激活时间';
ALTER TABLE user_invitation MODIFY COLUMN created_user_id BIGINT NULL COMMENT '激活后创建的 sys_user.id';
ALTER TABLE user_invitation MODIFY COLUMN revoked_by BIGINT NULL COMMENT '撤销人 sys_user.id';
ALTER TABLE user_invitation MODIFY COLUMN revoked_at TIMESTAMP NULL COMMENT '撤销时间';
ALTER TABLE user_invitation MODIFY COLUMN revoke_reason VARCHAR(255) COMMENT '撤销原因';

-- ===================================================================
-- V1: sys_tenant 租户
-- ===================================================================
ALTER TABLE sys_tenant COMMENT = '租户表（每个分公司一条）';

ALTER TABLE sys_tenant MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_tenant MODIFY COLUMN code VARCHAR(64) NOT NULL COMMENT '租户编码（全局唯一），如 hy / bj';
ALTER TABLE sys_tenant MODIFY COLUMN name VARCHAR(128) NOT NULL COMMENT '租户名称';
ALTER TABLE sys_tenant MODIFY COLUMN datasource_key VARCHAR(64) NOT NULL COMMENT '数据源 key（路由到 tenant_xx 库）';
ALTER TABLE sys_tenant MODIFY COLUMN status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：ACTIVE=启用 / DISABLED=禁用';
ALTER TABLE sys_tenant MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V1: sys_tenant_datasource 租户数据源
-- ===================================================================
ALTER TABLE sys_tenant_datasource COMMENT = '租户数据源连接配置';

ALTER TABLE sys_tenant_datasource MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_tenant_datasource MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '租户 sys_tenant.id';
ALTER TABLE sys_tenant_datasource MODIFY COLUMN jdbc_url VARCHAR(512) NOT NULL COMMENT 'JDBC URL';
ALTER TABLE sys_tenant_datasource MODIFY COLUMN username VARCHAR(64) NOT NULL COMMENT '数据库用户名';
ALTER TABLE sys_tenant_datasource MODIFY COLUMN encrypted_password VARCHAR(512) NOT NULL COMMENT '加密后的数据库密码（AES-GCM）';
ALTER TABLE sys_tenant_datasource MODIFY COLUMN pool_min INT NOT NULL DEFAULT 2 COMMENT '连接池最小连接数';
ALTER TABLE sys_tenant_datasource MODIFY COLUMN pool_max INT NOT NULL DEFAULT 20 COMMENT '连接池最大连接数';
ALTER TABLE sys_tenant_datasource MODIFY COLUMN status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：ACTIVE=启用 / DISABLED=禁用';
ALTER TABLE sys_tenant_datasource MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V1: dingtalk_corp 钉钉企业配置
-- ===================================================================
ALTER TABLE dingtalk_corp COMMENT = '钉钉企业配置表（多 corpId）';

ALTER TABLE dingtalk_corp MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE dingtalk_corp MODIFY COLUMN corp_id VARCHAR(64) NOT NULL COMMENT '钉钉 corpId（全局唯一）';
ALTER TABLE dingtalk_corp MODIFY COLUMN corp_name VARCHAR(128) NOT NULL COMMENT '企业名称';
ALTER TABLE dingtalk_corp MODIFY COLUMN is_main TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否主企业：0=否 / 1=是';
ALTER TABLE dingtalk_corp MODIFY COLUMN agent_id VARCHAR(64) COMMENT '钉钉应用 agentId';
ALTER TABLE dingtalk_corp MODIFY COLUMN app_key VARCHAR(64) COMMENT '钉钉应用 appKey';
ALTER TABLE dingtalk_corp MODIFY COLUMN encrypted_app_secret VARCHAR(512) COMMENT '加密后的应用 secret（AES-GCM）';
ALTER TABLE dingtalk_corp MODIFY COLUMN access_token VARCHAR(512) COMMENT '当前 access_token';
ALTER TABLE dingtalk_corp MODIFY COLUMN access_token_expires_at TIMESTAMP NULL COMMENT 'access_token 过期时间';
ALTER TABLE dingtalk_corp MODIFY COLUMN bound_company_org_id BIGINT NULL COMMENT '绑定的分公司 sys_org.id（COMPANY 节点）';
ALTER TABLE dingtalk_corp MODIFY COLUMN whitelist_corp_ids JSON COMMENT '白名单 corpId 列表（JSON 数组）';
ALTER TABLE dingtalk_corp MODIFY COLUMN status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：ACTIVE=启用 / DISABLED=禁用';
ALTER TABLE dingtalk_corp MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE dingtalk_corp MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- ===================================================================
-- V1: sys_org_dingtalk_sync_log 钉钉同步日志
-- ===================================================================
ALTER TABLE sys_org_dingtalk_sync_log COMMENT = '钉钉组织同步日志';

ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN sync_type ENUM('FULL','EVENT') NOT NULL COMMENT '同步类型：FULL=全量 / EVENT=事件触发';
ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN trigger_event VARCHAR(64) COMMENT '触发事件名（仅 EVENT 类型）';
ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN affected_users INT NOT NULL DEFAULT 0 COMMENT '受影响用户数';
ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN affected_depts INT NOT NULL DEFAULT 0 COMMENT '受影响部门数';
ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN status ENUM('RUNNING','SUCCESS','FAILED') NOT NULL COMMENT '同步状态：RUNNING=进行中 / SUCCESS=成功 / FAILED=失败';
ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN error_msg TEXT COMMENT '错误信息';
ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间';
ALTER TABLE sys_org_dingtalk_sync_log MODIFY COLUMN finished_at TIMESTAMP NULL COMMENT '结束时间';

-- ===================================================================
-- V1: sys_audit_log 审计日志
-- ===================================================================
ALTER TABLE sys_audit_log COMMENT = '审计日志表（按月归档至 R2，详见 audit_archive_log）';

ALTER TABLE sys_audit_log MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sys_audit_log MODIFY COLUMN user_id BIGINT COMMENT '操作人 sys_user.id';
ALTER TABLE sys_audit_log MODIFY COLUMN username VARCHAR(64) COMMENT '操作人用户名（冗余便于查询）';
ALTER TABLE sys_audit_log MODIFY COLUMN employee_no VARCHAR(32) COMMENT '操作人工号（冗余）';
ALTER TABLE sys_audit_log MODIFY COLUMN org_id BIGINT COMMENT '操作时所在组织 sys_org.id';
ALTER TABLE sys_audit_log MODIFY COLUMN tenant_id BIGINT COMMENT '所属租户 sys_tenant.id';
ALTER TABLE sys_audit_log MODIFY COLUMN module VARCHAR(64) COMMENT '业务模块名';
ALTER TABLE sys_audit_log MODIFY COLUMN action VARCHAR(64) COMMENT '动作名';
ALTER TABLE sys_audit_log MODIFY COLUMN resource_type VARCHAR(64) COMMENT '资源类型';
ALTER TABLE sys_audit_log MODIFY COLUMN resource_id VARCHAR(128) COMMENT '资源 id';
ALTER TABLE sys_audit_log MODIFY COLUMN request_method VARCHAR(16) COMMENT 'HTTP 方法：GET/POST/PUT/DELETE 等';
ALTER TABLE sys_audit_log MODIFY COLUMN request_uri VARCHAR(512) COMMENT '请求 URI';
ALTER TABLE sys_audit_log MODIFY COLUMN request_payload JSON COMMENT '请求体 JSON（敏感字段已脱敏）';
ALTER TABLE sys_audit_log MODIFY COLUMN response_status INT COMMENT 'HTTP 响应状态码';
ALTER TABLE sys_audit_log MODIFY COLUMN ip VARCHAR(64) COMMENT '请求来源 IP';
ALTER TABLE sys_audit_log MODIFY COLUMN user_agent VARCHAR(512) COMMENT 'User-Agent';
ALTER TABLE sys_audit_log MODIFY COLUMN `sensitive` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否敏感操作：0=否 / 1=是';
ALTER TABLE sys_audit_log MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V4: store 店铺接入
-- ===================================================================
ALTER TABLE store COMMENT = '店铺接入表（Shopify 店铺及其 Token）';

ALTER TABLE store MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE store MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）';
ALTER TABLE store MODIFY COLUMN dept_id BIGINT NULL COMMENT '所属部门 sys_org.id';
ALTER TABLE store MODIFY COLUMN myshopify_domain VARCHAR(128) NOT NULL COMMENT 'Shopify 域名 xxx.myshopify.com（全局唯一）';
ALTER TABLE store MODIFY COLUMN custom_domain VARCHAR(128) NULL COMMENT '自定义域名';
ALTER TABLE store MODIFY COLUMN brand_name VARCHAR(128) NULL COMMENT '品牌名';
ALTER TABLE store MODIFY COLUMN token_type ENUM('cli', 'custom_app', 'oauth') NOT NULL COMMENT 'Token 类型：cli=CLI / custom_app=自建应用 / oauth=OAuth';
ALTER TABLE store MODIFY COLUMN encrypted_access_token VARCHAR(1024) NOT NULL COMMENT 'AES-GCM 加密的 access_token';
ALTER TABLE store MODIFY COLUMN encrypted_refresh_token VARCHAR(1024) NULL COMMENT 'AES-GCM 加密的 refresh_token';
ALTER TABLE store MODIFY COLUMN expires_at TIMESTAMP NULL COMMENT 'Token 过期时间（custom_app 永不过期 = NULL）';
ALTER TABLE store MODIFY COLUMN scopes JSON NULL COMMENT 'Token 授权范围（JSON 数组）';
ALTER TABLE store MODIFY COLUMN last_refresh_at TIMESTAMP NULL COMMENT '最近一次 Token 刷新时间';
ALTER TABLE store MODIFY COLUMN is_dev_store TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否 dev store：0=否 / 1=是';
ALTER TABLE store MODIFY COLUMN is_partner_collab TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否合作者协作店：0=否 / 1=是';
ALTER TABLE store MODIFY COLUMN status ENUM('ACTIVE', 'DISABLED', 'TOKEN_EXPIRED', 'UNINSTALLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：ACTIVE=活跃 / DISABLED=禁用 / TOKEN_EXPIRED=令牌过期 / UNINSTALLED=已卸载';
ALTER TABLE store MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE store MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE store MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V4: store_webhook 店铺 Webhook 注册
-- ===================================================================
ALTER TABLE store_webhook COMMENT = '店铺 Webhook 注册表';

ALTER TABLE store_webhook MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE store_webhook MODIFY COLUMN store_id BIGINT NOT NULL COMMENT '店铺 store.id';
ALTER TABLE store_webhook MODIFY COLUMN topic VARCHAR(64) NOT NULL COMMENT 'Webhook 主题（如 products/update）';
ALTER TABLE store_webhook MODIFY COLUMN callback_url VARCHAR(512) NOT NULL COMMENT '回调 URL';
ALTER TABLE store_webhook MODIFY COLUMN shopify_id VARCHAR(64) COMMENT 'Shopify 侧 webhook id';
ALTER TABLE store_webhook MODIFY COLUMN status ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '状态：ACTIVE=启用 / DISABLED=禁用';
ALTER TABLE store_webhook MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V4: oauth_session OAuth 临时 session
-- ===================================================================
ALTER TABLE oauth_session COMMENT = 'Shopify OAuth 临时会话表（10 分钟过期）';

ALTER TABLE oauth_session MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE oauth_session MODIFY COLUMN session_id VARCHAR(64) NOT NULL COMMENT '会话 id（全局唯一）';
ALTER TABLE oauth_session MODIFY COLUMN store_domain VARCHAR(128) NOT NULL COMMENT '店铺域名';
ALTER TABLE oauth_session MODIFY COLUMN scope VARCHAR(512) COMMENT '请求授权的 scope 列表';
ALTER TABLE oauth_session MODIFY COLUMN state_hmac VARCHAR(128) NOT NULL COMMENT '防 CSRF 的 state HMAC';
ALTER TABLE oauth_session MODIFY COLUMN status ENUM('PENDING', 'COMPLETED', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '状态：PENDING=进行中 / COMPLETED=完成 / EXPIRED=过期 / FAILED=失败';
ALTER TABLE oauth_session MODIFY COLUMN initiated_by BIGINT NOT NULL COMMENT '发起人 sys_user.id';
ALTER TABLE oauth_session MODIFY COLUMN initiated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发起时间';
ALTER TABLE oauth_session MODIFY COLUMN completed_at TIMESTAMP NULL COMMENT '完成时间';

-- ===================================================================
-- V5: product 产品主表
-- ===================================================================
ALTER TABLE product COMMENT = '产品主表（按 Shopify 42 列 CSV 模板对齐）';

ALTER TABLE product MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE product MODIFY COLUMN owner_company_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）';
ALTER TABLE product MODIFY COLUMN owner_dept_id BIGINT NULL COMMENT '所属部门 sys_org.id';
ALTER TABLE product MODIFY COLUMN handle VARCHAR(255) NOT NULL COMMENT '产品 handle（全平台唯一匹配键）';
ALTER TABLE product MODIFY COLUMN title VARCHAR(512) NOT NULL COMMENT '产品标题';
ALTER TABLE product MODIFY COLUMN body_html MEDIUMTEXT COMMENT '产品描述（HTML）';
ALTER TABLE product MODIFY COLUMN vendor VARCHAR(255) COMMENT '供应商';
ALTER TABLE product MODIFY COLUMN product_category VARCHAR(255) COMMENT '产品分类';
ALTER TABLE product MODIFY COLUMN type VARCHAR(255) COMMENT '产品类型';
ALTER TABLE product MODIFY COLUMN tags VARCHAR(1024) COMMENT '标签（逗号分隔）';
ALTER TABLE product MODIFY COLUMN published TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否发布：0=未发布 / 1=已发布';
ALTER TABLE product MODIFY COLUMN seo_title VARCHAR(255) COMMENT 'SEO 标题';
ALTER TABLE product MODIFY COLUMN seo_description VARCHAR(1024) COMMENT 'SEO 描述';
ALTER TABLE product MODIFY COLUMN status ENUM('active', 'draft', 'archived') NOT NULL DEFAULT 'draft' COMMENT '状态：active=上架 / draft=草稿 / archived=归档';
ALTER TABLE product MODIFY COLUMN created_by BIGINT COMMENT '创建人 sys_user.id';
ALTER TABLE product MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE product MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE product MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V5: product_option 产品选项
-- ===================================================================
ALTER TABLE product_option COMMENT = '产品选项表（Option1/Option2/Option3）';

ALTER TABLE product_option MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE product_option MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '产品 product.id';
ALTER TABLE product_option MODIFY COLUMN name VARCHAR(255) NOT NULL COMMENT '选项名（Option1 Name / Option2 Name / Option3 Name）';
ALTER TABLE product_option MODIFY COLUMN position INT NOT NULL DEFAULT 1 COMMENT '选项序号（1/2/3）';
ALTER TABLE product_option MODIFY COLUMN linked_to VARCHAR(255) NULL COMMENT '链接到的目标（Option Linked To）';

-- ===================================================================
-- V5: product_variant 产品变体
-- ===================================================================
ALTER TABLE product_variant COMMENT = '产品变体表（每个 SKU 一行）';

ALTER TABLE product_variant MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE product_variant MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '产品 product.id';
ALTER TABLE product_variant MODIFY COLUMN sku VARCHAR(255) COMMENT 'SKU 编码';
ALTER TABLE product_variant MODIFY COLUMN position INT NOT NULL DEFAULT 1 COMMENT '排序';
ALTER TABLE product_variant MODIFY COLUMN option1 VARCHAR(255) COMMENT '选项 1 取值';
ALTER TABLE product_variant MODIFY COLUMN option2 VARCHAR(255) COMMENT '选项 2 取值';
ALTER TABLE product_variant MODIFY COLUMN option3 VARCHAR(255) COMMENT '选项 3 取值';
ALTER TABLE product_variant MODIFY COLUMN grams DECIMAL(10, 2) DEFAULT 0 COMMENT '重量（克）';
ALTER TABLE product_variant MODIFY COLUMN weight_unit VARCHAR(16) DEFAULT 'g' COMMENT '重量单位';
ALTER TABLE product_variant MODIFY COLUMN inventory_tracker VARCHAR(64) COMMENT '库存追踪器：shopify / null';
ALTER TABLE product_variant MODIFY COLUMN inventory_qty INT DEFAULT 0 COMMENT '库存数量';
ALTER TABLE product_variant MODIFY COLUMN inventory_policy ENUM('deny', 'continue') NOT NULL DEFAULT 'continue' COMMENT '库存策略：deny=售罄拒卖 / continue=允许超卖';
ALTER TABLE product_variant MODIFY COLUMN fulfillment_service VARCHAR(64) DEFAULT 'manual' COMMENT '履约服务';
ALTER TABLE product_variant MODIFY COLUMN price DECIMAL(12, 2) NOT NULL DEFAULT 0 COMMENT '售价';
ALTER TABLE product_variant MODIFY COLUMN compare_at_price DECIMAL(12, 2) COMMENT '划线价（原价）';
ALTER TABLE product_variant MODIFY COLUMN requires_shipping TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否需要发货：0=否 / 1=是';
ALTER TABLE product_variant MODIFY COLUMN taxable TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否计税：0=否 / 1=是';
ALTER TABLE product_variant MODIFY COLUMN barcode VARCHAR(128) COMMENT '条形码';
ALTER TABLE product_variant MODIFY COLUMN unit_price_total_measure DECIMAL(12, 4) COMMENT '单位定价：总计量值';
ALTER TABLE product_variant MODIFY COLUMN unit_price_total_measure_unit VARCHAR(32) COMMENT '单位定价：总计量单位';
ALTER TABLE product_variant MODIFY COLUMN unit_price_base_measure DECIMAL(12, 4) COMMENT '单位定价：基础计量值';
ALTER TABLE product_variant MODIFY COLUMN unit_price_base_measure_unit VARCHAR(32) COMMENT '单位定价：基础计量单位';
ALTER TABLE product_variant MODIFY COLUMN variant_image VARCHAR(1024) COMMENT '变体图片 URL';
ALTER TABLE product_variant MODIFY COLUMN tax_code VARCHAR(64) COMMENT '税码';
ALTER TABLE product_variant MODIFY COLUMN cost_per_item DECIMAL(12, 2) COMMENT '单件成本';
ALTER TABLE product_variant MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE product_variant MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE product_variant MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V5 + V12: product_image 产品图片
-- ===================================================================
ALTER TABLE product_image COMMENT = '产品图片表';

ALTER TABLE product_image MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE product_image MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '产品 product.id';
ALTER TABLE product_image MODIFY COLUMN src VARCHAR(1024) NOT NULL COMMENT '图片 URL';
-- V12 新增列：r2_key（位于 src 之后）
ALTER TABLE product_image MODIFY COLUMN r2_key VARCHAR(512) NULL DEFAULT NULL COMMENT 'R2 对象 key（push 走 base64 attachment 路径用）';
ALTER TABLE product_image MODIFY COLUMN position INT NOT NULL DEFAULT 1 COMMENT '排序（1=主图）';
ALTER TABLE product_image MODIFY COLUMN alt_text VARCHAR(512) COMMENT '替代文本（无障碍）';
ALTER TABLE product_image MODIFY COLUMN gift_card TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否礼品卡图：0=否 / 1=是';

-- ===================================================================
-- V5: product_metafield 产品 metafields
-- ===================================================================
ALTER TABLE product_metafield COMMENT = '产品 metafields 自定义元数据';

ALTER TABLE product_metafield MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE product_metafield MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '产品 product.id';
ALTER TABLE product_metafield MODIFY COLUMN `namespace` VARCHAR(64) NOT NULL COMMENT '命名空间';
ALTER TABLE product_metafield MODIFY COLUMN `key` VARCHAR(64) NOT NULL COMMENT '键名';
ALTER TABLE product_metafield MODIFY COLUMN value TEXT COMMENT '值';
ALTER TABLE product_metafield MODIFY COLUMN type VARCHAR(64) COMMENT '类型（string/json/integer 等）';

-- ===================================================================
-- V5: product_external_link 产品外部链接
-- ===================================================================
ALTER TABLE product_external_link COMMENT = '产品外部链接（广告贴 / 对标页 / 产品素材）';

ALTER TABLE product_external_link MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE product_external_link MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '产品 product.id';
ALTER TABLE product_external_link MODIFY COLUMN kind ENUM('AD', 'BENCHMARK', 'MATERIAL') NOT NULL COMMENT '类型：AD=广告贴 / BENCHMARK=对标页 / MATERIAL=产品素材';
ALTER TABLE product_external_link MODIFY COLUMN url VARCHAR(1024) NOT NULL COMMENT '链接 URL';
ALTER TABLE product_external_link MODIFY COLUMN note VARCHAR(512) COMMENT '备注';
ALTER TABLE product_external_link MODIFY COLUMN created_by BIGINT COMMENT '创建人 sys_user.id';
ALTER TABLE product_external_link MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V5: file_sign_token 文件签名 token
-- ===================================================================
ALTER TABLE file_sign_token COMMENT = '文件签名 token 表（折中方案 B：批量预签）';

ALTER TABLE file_sign_token MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE file_sign_token MODIFY COLUMN user_id BIGINT NOT NULL COMMENT '用户 sys_user.id';
ALTER TABLE file_sign_token MODIFY COLUMN token VARCHAR(64) NOT NULL COMMENT 'token（全局唯一）';
ALTER TABLE file_sign_token MODIFY COLUMN scope_keys JSON NOT NULL COMMENT '允许签发的 R2 key 列表（JSON 数组）';
ALTER TABLE file_sign_token MODIFY COLUMN expires_at TIMESTAMP NOT NULL COMMENT 'token 过期时间';
ALTER TABLE file_sign_token MODIFY COLUMN used_count INT NOT NULL DEFAULT 0 COMMENT '已使用次数';
ALTER TABLE file_sign_token MODIFY COLUMN max_uses INT NOT NULL DEFAULT 1000 COMMENT '最大使用次数';
ALTER TABLE file_sign_token MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V6: purchase_info 采购信息（变体级）
-- ===================================================================
ALTER TABLE purchase_info COMMENT = '采购信息表（变体级，一对一 product_variant）';

ALTER TABLE purchase_info MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE purchase_info MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '产品 product.id';
ALTER TABLE purchase_info MODIFY COLUMN variant_id BIGINT NOT NULL COMMENT '变体 product_variant.id（一对一；改 SKU 时联动）';
ALTER TABLE purchase_info MODIFY COLUMN purchase_url VARCHAR(1024) COMMENT '采购链接（如 1688）';
ALTER TABLE purchase_info MODIFY COLUMN cost DECIMAL(12, 2) COMMENT '采购成本';
ALTER TABLE purchase_info MODIFY COLUMN currency VARCHAR(8) DEFAULT 'CNY' COMMENT '币种 ISO 4217';
ALTER TABLE purchase_info MODIFY COLUMN gross_weight DECIMAL(10, 2) COMMENT '毛重（含包装）';
ALTER TABLE purchase_info MODIFY COLUMN weight_unit VARCHAR(8) DEFAULT 'g' COMMENT '重量单位';
ALTER TABLE purchase_info MODIFY COLUMN logistics_tags JSON COMMENT '物流标签 JSON 数组：液体/带电/液体充电等';
ALTER TABLE purchase_info MODIFY COLUMN note VARCHAR(1024) COMMENT '备注';
ALTER TABLE purchase_info MODIFY COLUMN updated_by BIGINT COMMENT '最后修改人 sys_user.id';
ALTER TABLE purchase_info MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE purchase_info MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE purchase_info MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V6: sku_change_log SKU 变更审计
-- ===================================================================
ALTER TABLE sku_change_log COMMENT = 'SKU 变更审计日志';

ALTER TABLE sku_change_log MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE sku_change_log MODIFY COLUMN variant_id BIGINT NOT NULL COMMENT '变体 product_variant.id';
ALTER TABLE sku_change_log MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '产品 product.id';
ALTER TABLE sku_change_log MODIFY COLUMN old_sku VARCHAR(255) COMMENT '变更前 SKU';
ALTER TABLE sku_change_log MODIFY COLUMN new_sku VARCHAR(255) NOT NULL COMMENT '变更后 SKU';
ALTER TABLE sku_change_log MODIFY COLUMN changed_by BIGINT NOT NULL COMMENT '变更人 sys_user.id';
ALTER TABLE sku_change_log MODIFY COLUMN confirmed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '确认时间';
ALTER TABLE sku_change_log MODIFY COLUMN sync_status ENUM('PENDING', 'SUCCESS', 'PARTIAL', 'FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '同步状态：PENDING=待同步 / SUCCESS=成功 / PARTIAL=部分成功 / FAILED=失败';
ALTER TABLE sku_change_log MODIFY COLUMN sync_result JSON COMMENT '同步结果 JSON';

-- ===================================================================
-- V6 + V7: product_doc 产品媒体/需求文档
-- ===================================================================
ALTER TABLE product_doc COMMENT = '产品媒体/需求文档表（富文本 或 文件）';

ALTER TABLE product_doc MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE product_doc MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '产品 product.id';
ALTER TABLE product_doc MODIFY COLUMN type ENUM('RICH_TEXT', 'FILE') NOT NULL COMMENT '类型：RICH_TEXT=富文本 / FILE=文件';
-- V7 把 rich_text_json 从 JSON 改为 LONGTEXT
ALTER TABLE product_doc MODIFY COLUMN rich_text_json LONGTEXT NULL COMMENT 'TipTap 输出 HTML（字段名沿用 rich_text_json 历史，类型为 LONGTEXT）';
ALTER TABLE product_doc MODIFY COLUMN file_r2_key VARCHAR(512) NULL COMMENT '文件 R2 对象 key（FILE 模式）';
ALTER TABLE product_doc MODIFY COLUMN file_url VARCHAR(1024) NULL COMMENT '文件展示 URL';
ALTER TABLE product_doc MODIFY COLUMN file_name VARCHAR(255) NULL COMMENT '文件原名';
ALTER TABLE product_doc MODIFY COLUMN file_size BIGINT NULL COMMENT '文件大小（字节）';
ALTER TABLE product_doc MODIFY COLUMN file_mime VARCHAR(128) NULL COMMENT '文件 MIME 类型';
ALTER TABLE product_doc MODIFY COLUMN title VARCHAR(255) COMMENT '文档标题，便于列表展示';
ALTER TABLE product_doc MODIFY COLUMN sort INT NOT NULL DEFAULT 0 COMMENT '排序';
ALTER TABLE product_doc MODIFY COLUMN created_by BIGINT NOT NULL COMMENT '创建人 sys_user.id';
ALTER TABLE product_doc MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE product_doc MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE product_doc MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V8 + V25: asset_snapshot 资产快照主表
-- ===================================================================
ALTER TABLE asset_snapshot COMMENT = '资产快照主表（Shopify 主题/政策/产品资产抓取登记）';

ALTER TABLE asset_snapshot MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE asset_snapshot MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）';
ALTER TABLE asset_snapshot MODIFY COLUMN store_id BIGINT NOT NULL COMMENT '关联 store.id';
ALTER TABLE asset_snapshot MODIFY COLUMN snapshot_type ENUM('THEME', 'POLICY', 'MENU', 'COLLECTION', 'PRODUCT', 'FULL') NOT NULL COMMENT '快照类型：THEME=主题 / POLICY=政策 / MENU=菜单 / COLLECTION=合集 / PRODUCT=产品 / FULL=全量';
-- V25 把 status 枚举扩到含 CANCELED
ALTER TABLE asset_snapshot MODIFY COLUMN status ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'PENDING' COMMENT '快照状态：PENDING=待处理 / RUNNING=运行中 / SUCCESS=成功 / FAILED=失败 / CANCELED=已取消';
ALTER TABLE asset_snapshot MODIFY COLUMN r2_prefix VARCHAR(256) NOT NULL COMMENT 'R2 对象前缀，例如 tenants/1/stores/3/snapshots/42/';
ALTER TABLE asset_snapshot MODIFY COLUMN manifest_json LONGTEXT NULL COMMENT '清单 JSON（文件列表/校验信息）';
ALTER TABLE asset_snapshot MODIFY COLUMN file_count INT NOT NULL DEFAULT 0 COMMENT '文件总数';
ALTER TABLE asset_snapshot MODIFY COLUMN total_bytes BIGINT NOT NULL DEFAULT 0 COMMENT '总字节数';
ALTER TABLE asset_snapshot MODIFY COLUMN error_message TEXT NULL COMMENT '失败原因';
ALTER TABLE asset_snapshot MODIFY COLUMN triggered_by BIGINT NULL COMMENT '触发者 sys_user.id；定时任务为 NULL';
ALTER TABLE asset_snapshot MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE asset_snapshot MODIFY COLUMN started_at TIMESTAMP NULL COMMENT '开始执行时间';
ALTER TABLE asset_snapshot MODIFY COLUMN completed_at TIMESTAMP NULL COMMENT '完成时间';
ALTER TABLE asset_snapshot MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V8: asset_file 资产快照文件清单
-- ===================================================================
ALTER TABLE asset_file COMMENT = '资产快照文件清单';

ALTER TABLE asset_file MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE asset_file MODIFY COLUMN snapshot_id BIGINT NOT NULL COMMENT '快照 asset_snapshot.id';
ALTER TABLE asset_file MODIFY COLUMN relative_path VARCHAR(512) NOT NULL COMMENT '相对路径，例如 templates/index.json';
ALTER TABLE asset_file MODIFY COLUMN r2_key VARCHAR(512) NOT NULL COMMENT 'R2 对象完整 key';
ALTER TABLE asset_file MODIFY COLUMN size_bytes BIGINT NOT NULL COMMENT '文件字节数';
ALTER TABLE asset_file MODIFY COLUMN content_type VARCHAR(128) NULL COMMENT 'MIME 类型';
ALTER TABLE asset_file MODIFY COLUMN sha256 CHAR(64) NULL COMMENT '文件 SHA256 摘要';
ALTER TABLE asset_file MODIFY COLUMN downloaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下载落 R2 时间';

-- ===================================================================
-- V9 + V11: product_snapshot 产品快照主表
-- ===================================================================
ALTER TABLE product_snapshot COMMENT = '产品快照主表（按 Webhook/手动/定时/推送后触发）';

ALTER TABLE product_snapshot MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE product_snapshot MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）';
ALTER TABLE product_snapshot MODIFY COLUMN store_id BIGINT NOT NULL COMMENT '关联 store.id';
ALTER TABLE product_snapshot MODIFY COLUMN product_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify 产品 GID 或数字 id';
ALTER TABLE product_snapshot MODIFY COLUMN product_id BIGINT NULL COMMENT '若已映射到平台 product.id 则填写';
ALTER TABLE product_snapshot MODIFY COLUMN trigger_event ENUM('WEBHOOK_UPDATE', 'MANUAL', 'SCHEDULE', 'PUSH_DONE') NOT NULL COMMENT '触发来源：WEBHOOK_UPDATE=Shopify webhook / MANUAL=手动 / SCHEDULE=定时 / PUSH_DONE=推送完成回拉';
ALTER TABLE product_snapshot MODIFY COLUMN status ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '快照状态：PENDING=待处理 / RUNNING=运行中 / SUCCESS=成功 / FAILED=失败';
ALTER TABLE product_snapshot MODIFY COLUMN csv_r2_key VARCHAR(512) NULL COMMENT '导出的 42 列 CSV 在 R2 的 key';
ALTER TABLE product_snapshot MODIFY COLUMN json_r2_key VARCHAR(512) NULL COMMENT '完整 Shopify JSON dump 在 R2 的 key';
ALTER TABLE product_snapshot MODIFY COLUMN diff_summary_json TEXT NULL COMMENT '差异摘要 JSON：{"changed_fields":[...],"field_count":N}';
ALTER TABLE product_snapshot MODIFY COLUMN total_bytes BIGINT NOT NULL DEFAULT 0 COMMENT '总字节数（CSV+JSON）';
ALTER TABLE product_snapshot MODIFY COLUMN error_message TEXT NULL COMMENT '失败原因';
ALTER TABLE product_snapshot MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
-- V11 新增列：started_at（位于 created_at 之后）
ALTER TABLE product_snapshot MODIFY COLUMN started_at TIMESTAMP NULL DEFAULT NULL COMMENT '开始执行时间';
ALTER TABLE product_snapshot MODIFY COLUMN completed_at TIMESTAMP NULL COMMENT '完成时间';
ALTER TABLE product_snapshot MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V9: product_price_history 产品 variant 价格变更历史（按月分区）
-- ===================================================================
ALTER TABLE product_price_history COMMENT = '产品 variant 价格变更历史（按 changed_at 月分区）';

ALTER TABLE product_price_history MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键（与 changed_at 联合主键）';
ALTER TABLE product_price_history MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id';
ALTER TABLE product_price_history MODIFY COLUMN store_id BIGINT NOT NULL COMMENT '关联 store.id';
ALTER TABLE product_price_history MODIFY COLUMN product_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify 产品 GID/数字 id';
ALTER TABLE product_price_history MODIFY COLUMN variant_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify variant GID/数字 id';
ALTER TABLE product_price_history MODIFY COLUMN price DECIMAL(15, 4) NOT NULL COMMENT '变更后价格';
ALTER TABLE product_price_history MODIFY COLUMN compare_at_price DECIMAL(15, 4) NULL COMMENT '划线价';
ALTER TABLE product_price_history MODIFY COLUMN old_price DECIMAL(15, 4) NULL COMMENT '变更前价格（用于 diff）';
ALTER TABLE product_price_history MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT '币种 ISO 4217';
ALTER TABLE product_price_history MODIFY COLUMN changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间（分区键，使用 DATETIME 以支持分区表达式）';
ALTER TABLE product_price_history MODIFY COLUMN source ENUM('WEBHOOK', 'MANUAL', 'PUSH') NOT NULL DEFAULT 'WEBHOOK' COMMENT '变更来源：WEBHOOK=Shopify webhook / MANUAL=手动 / PUSH=推送时';

-- ===================================================================
-- V9: product_inventory_history 产品 variant 库存变更历史（按月分区）
-- ===================================================================
ALTER TABLE product_inventory_history COMMENT = '产品 variant 库存变更历史（按 changed_at 月分区）';

ALTER TABLE product_inventory_history MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键（与 changed_at 联合主键）';
ALTER TABLE product_inventory_history MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id';
ALTER TABLE product_inventory_history MODIFY COLUMN store_id BIGINT NOT NULL COMMENT '关联 store.id';
ALTER TABLE product_inventory_history MODIFY COLUMN product_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify 产品 GID/数字 id';
ALTER TABLE product_inventory_history MODIFY COLUMN variant_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify variant GID/数字 id';
ALTER TABLE product_inventory_history MODIFY COLUMN inventory_quantity INT NOT NULL COMMENT '变更后库存数量';
ALTER TABLE product_inventory_history MODIFY COLUMN old_quantity INT NULL COMMENT '变更前库存数量（用于 diff）';
ALTER TABLE product_inventory_history MODIFY COLUMN changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间（分区键，使用 DATETIME 以支持分区表达式）';
ALTER TABLE product_inventory_history MODIFY COLUMN source ENUM('WEBHOOK', 'MANUAL', 'PUSH') NOT NULL DEFAULT 'WEBHOOK' COMMENT '变更来源：WEBHOOK=Shopify webhook / MANUAL=手动 / PUSH=推送时';

-- ===================================================================
-- V10: store_product 内部产品 → 店铺 Shopify 产品映射
-- ===================================================================
ALTER TABLE store_product COMMENT = '内部产品 → 店铺 Shopify 产品映射表';

ALTER TABLE store_product MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE store_product MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）';
ALTER TABLE store_product MODIFY COLUMN store_id BIGINT NOT NULL COMMENT '关联 store.id';
ALTER TABLE store_product MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '内部 product.id（平台侧产品主表）';
ALTER TABLE store_product MODIFY COLUMN shopify_product_id VARCHAR(64) NULL COMMENT 'Shopify 产品 id（数字或 GID），未推送前为 NULL';
ALTER TABLE store_product MODIFY COLUMN shopify_handle VARCHAR(255) NULL COMMENT 'Shopify 实际 handle（可能与 product.handle 不同，发生重命名时）';
ALTER TABLE store_product MODIFY COLUMN status ENUM('NOT_PUSHED', 'PUSHING', 'ACTIVE', 'DRAFT', 'ARCHIVED', 'FAILED') NOT NULL DEFAULT 'NOT_PUSHED' COMMENT '推送状态：NOT_PUSHED=未推送 / PUSHING=推送中 / ACTIVE=已上架 / DRAFT=草稿 / ARCHIVED=归档 / FAILED=失败';
ALTER TABLE store_product MODIFY COLUMN last_push_task_id BIGINT NULL COMMENT '最近一次推送任务 task.id（无外键）';
ALTER TABLE store_product MODIFY COLUMN last_pushed_at TIMESTAMP NULL COMMENT '最近一次推送完成时间';
ALTER TABLE store_product MODIFY COLUMN last_pulled_at TIMESTAMP NULL COMMENT '最近一次回拉时间（PUSH_DONE / 手动拉取）';
ALTER TABLE store_product MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE store_product MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE store_product MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V10: store_product_variant 内部 variant → 店铺 Shopify variant 映射
-- ===================================================================
ALTER TABLE store_product_variant COMMENT = '内部 variant → 店铺 Shopify variant 映射表';

ALTER TABLE store_product_variant MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE store_product_variant MODIFY COLUMN store_product_id BIGINT NOT NULL COMMENT '关联 store_product.id';
ALTER TABLE store_product_variant MODIFY COLUMN product_variant_id BIGINT NOT NULL COMMENT '内部 product_variant.id';
ALTER TABLE store_product_variant MODIFY COLUMN shopify_variant_id VARCHAR(64) NULL COMMENT 'Shopify variant id（数字或 GID）';
ALTER TABLE store_product_variant MODIFY COLUMN sku VARCHAR(128) NULL COMMENT '推送时使用的 SKU（用于冲突诊断）';
ALTER TABLE store_product_variant MODIFY COLUMN shopify_inventory_item_id VARCHAR(64) NULL COMMENT 'Shopify inventory_item id（用于库存上架/调整）';
ALTER TABLE store_product_variant MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE store_product_variant MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE store_product_variant MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V10 + V13: task 通用异步任务登记
-- ===================================================================
ALTER TABLE task COMMENT = '通用异步任务登记表（push/pull/snapshot/preview/saga 等）';

ALTER TABLE task MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE task MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id';
ALTER TABLE task MODIFY COLUMN type ENUM('PRODUCT_PUSH', 'PRODUCT_PULL', 'THEME_PULL', 'POLICY_PULL', 'MENU_PULL', 'COLLECTION_PULL', 'SNAPSHOT', 'PREVIEW', 'NEW_STORE_SAGA', 'OTHER') NOT NULL COMMENT '任务类型：PRODUCT_PUSH=产品推送 / PRODUCT_PULL=产品回拉 / THEME_PULL=主题拉取 / POLICY_PULL=政策拉取 / MENU_PULL=菜单拉取 / COLLECTION_PULL=合集拉取 / SNAPSHOT=快照 / PREVIEW=预览 / NEW_STORE_SAGA=一键开店 / OTHER=其他';
ALTER TABLE task MODIFY COLUMN status ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL', 'CANCELED') NOT NULL DEFAULT 'PENDING' COMMENT '任务状态：PENDING=待处理 / RUNNING=运行中 / SUCCESS=成功 / FAILED=失败 / PARTIAL=部分成功 / CANCELED=已取消';
-- V13 新增列：saga_step（位于 status 之后）
ALTER TABLE task MODIFY COLUMN saga_step VARCHAR(64) NULL DEFAULT NULL COMMENT 'Saga 当前步骤：INIT/AUTH_DONE/MEDIA/COLLECTIONS/PRODUCTS/GUIDE/THEME/PUBLISH/SUCCESS/FAILED；NULL=非 saga';
ALTER TABLE task MODIFY COLUMN store_id BIGINT NULL COMMENT '关联 store.id（部分任务无关联）';
ALTER TABLE task MODIFY COLUMN payload_json LONGTEXT NULL COMMENT '请求体 / 参数 JSON';
-- V13 新增列：saga_data_json（位于 payload_json 之后）
ALTER TABLE task MODIFY COLUMN saga_data_json LONGTEXT NULL DEFAULT NULL COMMENT 'Saga 累积上下文（已完成步骤的输出，下一步的输入）';
-- V13 新增列：saga_attempt（位于 saga_data_json 之后）
ALTER TABLE task MODIFY COLUMN saga_attempt INT NOT NULL DEFAULT 0 COMMENT 'Saga 当前 step 的重试次数（0=首次，>0=重试）';
ALTER TABLE task MODIFY COLUMN result_json LONGTEXT NULL COMMENT '响应 / 累计结果 JSON';
ALTER TABLE task MODIFY COLUMN error_message TEXT NULL COMMENT '失败原因';
ALTER TABLE task MODIFY COLUMN triggered_by BIGINT NULL COMMENT '触发者 sys_user.id；定时任务为 NULL';
ALTER TABLE task MODIFY COLUMN parent_task_id BIGINT NULL COMMENT 'SAGA 父任务 task.id（无外键）';
ALTER TABLE task MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE task MODIFY COLUMN started_at TIMESTAMP NULL COMMENT '开始执行时间';
ALTER TABLE task MODIFY COLUMN completed_at TIMESTAMP NULL COMMENT '完成时间';
ALTER TABLE task MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V10: push_conflict 推送冲突登记
-- ===================================================================
ALTER TABLE push_conflict COMMENT = '推送冲突登记表（handle/sku 冲突等待用户决策）';

ALTER TABLE push_conflict MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE push_conflict MODIFY COLUMN task_id BIGINT NOT NULL COMMENT '关联 task.id（无外键）';
ALTER TABLE push_conflict MODIFY COLUMN product_id BIGINT NOT NULL COMMENT '内部 product.id';
ALTER TABLE push_conflict MODIFY COLUMN store_id BIGINT NOT NULL COMMENT '关联 store.id';
ALTER TABLE push_conflict MODIFY COLUMN conflict_type ENUM('HANDLE_TAKEN', 'SKU_DUPLICATE', 'VARIANT_OPTION_MISMATCH', 'OTHER') NOT NULL COMMENT '冲突类型：HANDLE_TAKEN=handle 占用 / SKU_DUPLICATE=SKU 重复 / VARIANT_OPTION_MISMATCH=选项不匹配 / OTHER=其他';
ALTER TABLE push_conflict MODIFY COLUMN detail_json TEXT NULL COMMENT '冲突详情 JSON：{existing_product_id, conflicting_handle, ...}';
ALTER TABLE push_conflict MODIFY COLUMN status ENUM('PENDING', 'RESOLVED_OVERWRITE', 'RESOLVED_RENAME', 'RESOLVED_SKIP', 'EXPIRED') NOT NULL DEFAULT 'PENDING' COMMENT '冲突解决状态：PENDING=待解决 / RESOLVED_OVERWRITE=覆盖 / RESOLVED_RENAME=重命名 / RESOLVED_SKIP=跳过 / EXPIRED=过期';
ALTER TABLE push_conflict MODIFY COLUMN resolution_payload_json TEXT NULL COMMENT '用户决策附带数据 JSON';
ALTER TABLE push_conflict MODIFY COLUMN resolved_by BIGINT NULL COMMENT '解决者 sys_user.id';
ALTER TABLE push_conflict MODIFY COLUMN resolved_at TIMESTAMP NULL COMMENT '解决时间';
ALTER TABLE push_conflict MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE push_conflict MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V15: base_template 平台主题模板主表
-- ===================================================================
ALTER TABLE base_template COMMENT = '平台主题模板主表（可复用模板）';

ALTER TABLE base_template MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE base_template MODIFY COLUMN code VARCHAR(64) NOT NULL COMMENT '模板唯一编码，如 health-supplement-v1';
ALTER TABLE base_template MODIFY COLUMN name VARCHAR(128) NOT NULL COMMENT '模板展示名（中英文）';
ALTER TABLE base_template MODIFY COLUMN description TEXT NULL COMMENT '模板描述';
ALTER TABLE base_template MODIFY COLUMN category VARCHAR(64) NULL COMMENT '分类：health / beauty / general 等';
ALTER TABLE base_template MODIFY COLUMN cover_image_r2_key VARCHAR(512) NULL COMMENT '模板预览图在 R2 的 key（可空，frontend 加占位）';
ALTER TABLE base_template MODIFY COLUMN default_template_version_id BIGINT NULL COMMENT '指向 base_template_version.id；新建时空，发布版本后填（无外键）';
ALTER TABLE base_template MODIFY COLUMN status ENUM('DRAFT', 'PUBLISHED', 'DEPRECATED') NOT NULL DEFAULT 'DRAFT' COMMENT '模板状态：DRAFT=草稿 / PUBLISHED=已发布 / DEPRECATED=已弃用';
ALTER TABLE base_template MODIFY COLUMN created_by BIGINT NULL COMMENT '创建者 sys_user.id';
ALTER TABLE base_template MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE base_template MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE base_template MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V15: base_template_version 平台主题模板版本表
-- ===================================================================
ALTER TABLE base_template_version COMMENT = '平台主题模板版本表';

ALTER TABLE base_template_version MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE base_template_version MODIFY COLUMN template_id BIGINT NOT NULL COMMENT '关联 base_template.id（无外键）';
ALTER TABLE base_template_version MODIFY COLUMN version VARCHAR(32) NOT NULL COMMENT 'semver-ish 版本号：1.0.0 / 1.1.0-beta';
ALTER TABLE base_template_version MODIFY COLUMN zip_r2_key VARCHAR(512) NOT NULL COMMENT '主题 zip 在 R2 的 key';
ALTER TABLE base_template_version MODIFY COLUMN zip_bytes BIGINT NULL COMMENT 'zip 文件字节数（展示用）';
ALTER TABLE base_template_version MODIFY COLUMN zip_sha256 CHAR(64) NULL COMMENT 'zip 文件 SHA256，用于完整性校验';
ALTER TABLE base_template_version MODIFY COLUMN default_replace_rules_json TEXT NULL COMMENT '默认替换规则 JSON：{"shop_name":{"from":"BIOU","to":"{{brand}}"}, ...}';
ALTER TABLE base_template_version MODIFY COLUMN changelog TEXT NULL COMMENT '版本变更日志 markdown';
ALTER TABLE base_template_version MODIFY COLUMN status ENUM('DRAFT', 'PUBLISHED', 'DEPRECATED') NOT NULL DEFAULT 'DRAFT' COMMENT '版本状态：DRAFT=草稿 / PUBLISHED=已发布 / DEPRECATED=已弃用';
ALTER TABLE base_template_version MODIFY COLUMN created_by BIGINT NULL COMMENT '创建者 sys_user.id';
ALTER TABLE base_template_version MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE base_template_version MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE base_template_version MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V15: guide_doc 一键开店向导指引文档
-- ===================================================================
ALTER TABLE guide_doc COMMENT = '一键开店向导指引文档表';

ALTER TABLE guide_doc MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE guide_doc MODIFY COLUMN code VARCHAR(64) NOT NULL COMMENT '指引唯一编码，如 menu_setup_after_newstore / policy_legal_template';
ALTER TABLE guide_doc MODIFY COLUMN title VARCHAR(255) NOT NULL COMMENT '指引标题';
ALTER TABLE guide_doc MODIFY COLUMN category VARCHAR(64) NULL COMMENT '分类：menu / policy / markets / general 等';
ALTER TABLE guide_doc MODIFY COLUMN body_html LONGTEXT NULL COMMENT 'TipTap 输出 HTML（与 product_doc 一致，非 JSON）';
ALTER TABLE guide_doc MODIFY COLUMN body_markdown LONGTEXT NULL COMMENT '可选 markdown 源';
ALTER TABLE guide_doc MODIFY COLUMN related_template_id BIGINT NULL COMMENT '关联 base_template.id（NULL = 通用指引，无外键）';
ALTER TABLE guide_doc MODIFY COLUMN show_in_saga_step VARCHAR(64) NULL COMMENT '一键开店 saga 步骤标识：GUIDE 等；NULL = 不绑定 saga';
ALTER TABLE guide_doc MODIFY COLUMN status ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT' COMMENT '指引状态：DRAFT=草稿 / PUBLISHED=已发布 / ARCHIVED=已归档';
ALTER TABLE guide_doc MODIFY COLUMN created_by BIGINT NULL COMMENT '创建者 sys_user.id';
ALTER TABLE guide_doc MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE guide_doc MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
ALTER TABLE guide_doc MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间';

-- ===================================================================
-- V18: preview_theme 预览主题
-- ===================================================================
ALTER TABLE preview_theme COMMENT = 'Shopify 预览主题分配表（合作者 dev store 池，24h 自动过期）';

ALTER TABLE preview_theme MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE preview_theme MODIFY COLUMN tenant_id BIGINT NOT NULL COMMENT '申请者所在 tenant.id（用于多租户隔离）';
ALTER TABLE preview_theme MODIFY COLUMN source_product_id BIGINT NOT NULL COMMENT '我们内部 product.id（被预览的产品）';
ALTER TABLE preview_theme MODIFY COLUMN dev_store_id BIGINT NOT NULL COMMENT '选中的 partner-collab dev store.id（无外键）';
ALTER TABLE preview_theme MODIFY COLUMN shopify_theme_id VARCHAR(64) NULL COMMENT 'Worker 在 Shopify 创建的 theme id；初始 null，PV-04 worker 落地后填';
ALTER TABLE preview_theme MODIFY COLUMN preview_url VARCHAR(512) NULL COMMENT 'Shopify 主题预览 URL；初始 null，PV-04 worker 落地后填';
ALTER TABLE preview_theme MODIFY COLUMN status ENUM('PENDING', 'BUILDING', 'READY', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '预览主题状态：PENDING=待处理 / BUILDING=构建中 / READY=可访问 / EXPIRED=已过期 / FAILED=失败';
ALTER TABLE preview_theme MODIFY COLUMN last_accessed_at TIMESTAMP NULL COMMENT '最近一次用户点击预览链接的时间（前端 /preview/{id}/accessed 上报）';
ALTER TABLE preview_theme MODIFY COLUMN expires_at TIMESTAMP NULL COMMENT '硬过期时间（默认 created_at + 24h），cleanup cron 据此清理';
ALTER TABLE preview_theme MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（分配时刻）';
ALTER TABLE preview_theme MODIFY COLUMN completed_at TIMESTAMP NULL COMMENT 'Worker 把 theme 落到 Shopify 完成的时间（status=READY 时填）';
ALTER TABLE preview_theme MODIFY COLUMN error_message TEXT NULL COMMENT 'status=FAILED 时的错误描述';
ALTER TABLE preview_theme MODIFY COLUMN deleted_at TIMESTAMP NULL COMMENT '软删时间（@TableLogic）；cleanup cron 经此路径回收';

-- ===================================================================
-- V21: approval_flow 审批流主表
-- ===================================================================
ALTER TABLE approval_flow COMMENT = '审批流主表（产品授权 / 跨公司授权等）';

ALTER TABLE approval_flow MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE approval_flow MODIFY COLUMN tenant_id BIGINT NULL COMMENT '申请发起公司 tenant_id；为空表示平台级';
ALTER TABLE approval_flow MODIFY COLUMN `type` VARCHAR(64) NOT NULL COMMENT '审批类型：PRODUCT_ACCESS / CROSS_COMPANY_AUTH / ...';
ALTER TABLE approval_flow MODIFY COLUMN applicant_id BIGINT NOT NULL COMMENT '申请人 sys_user.id';
ALTER TABLE approval_flow MODIFY COLUMN target_user_id BIGINT NULL COMMENT '受益人；跨公司授权时 != applicant';
ALTER TABLE approval_flow MODIFY COLUMN payload JSON NOT NULL COMMENT '申请上下文 JSON：productId/scopeType/scopeId/expiresAt/reason 等';
ALTER TABLE approval_flow MODIFY COLUMN status ENUM('PENDING','APPROVED','REJECTED','CANCELLED','RESUBMITTED') NOT NULL DEFAULT 'PENDING' COMMENT '状态：PENDING=待审批 / APPROVED=已通过 / REJECTED=已驳回 / CANCELLED=已撤回 / RESUBMITTED=已重提';
ALTER TABLE approval_flow MODIFY COLUMN current_approver_id BIGINT NULL COMMENT 'PENDING 时指向某具体审批人；NULL 表示按角色任一';
ALTER TABLE approval_flow MODIFY COLUMN current_approver_role VARCHAR(64) NULL COMMENT '任一角色签批模式时指定角色 code';
ALTER TABLE approval_flow MODIFY COLUMN decided_by BIGINT NULL COMMENT '最终决策人 sys_user.id';
ALTER TABLE approval_flow MODIFY COLUMN decided_at TIMESTAMP NULL COMMENT '决策时间';
ALTER TABLE approval_flow MODIFY COLUMN decision_comment TEXT COMMENT '决策意见';
ALTER TABLE approval_flow MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE approval_flow MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- ===================================================================
-- V21: approval_log 审批轨迹
-- ===================================================================
ALTER TABLE approval_log COMMENT = '审批轨迹表（审批操作流水）';

ALTER TABLE approval_log MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE approval_log MODIFY COLUMN flow_id BIGINT NOT NULL COMMENT '审批流 approval_flow.id';
ALTER TABLE approval_log MODIFY COLUMN actor_id BIGINT NOT NULL COMMENT '操作人 sys_user.id';
ALTER TABLE approval_log MODIFY COLUMN action ENUM('SUBMIT','APPROVE','REJECT','RESUBMIT','CANCEL') NOT NULL COMMENT '动作：SUBMIT=提交 / APPROVE=通过 / REJECT=驳回 / RESUBMIT=重提 / CANCEL=撤回';
ALTER TABLE approval_log MODIFY COLUMN `comment` TEXT COMMENT '操作备注';
ALTER TABLE approval_log MODIFY COLUMN payload_snapshot JSON NULL COMMENT '重提时存当时 payload，便于追溯';
ALTER TABLE approval_log MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V22: notification_event_def 通知事件定义字典
-- ===================================================================
ALTER TABLE notification_event_def COMMENT = '通知事件定义字典';

ALTER TABLE notification_event_def MODIFY COLUMN code VARCHAR(64) NOT NULL COMMENT '事件编码（主键），如 INVITATION_SENT';
ALTER TABLE notification_event_def MODIFY COLUMN name VARCHAR(128) NOT NULL COMMENT '事件名称（中文展示）';
ALTER TABLE notification_event_def MODIFY COLUMN category VARCHAR(32) NOT NULL COMMENT '分类：INVITATION / SYSTEM / STORE / PUSH / OPS / APPROVAL';
ALTER TABLE notification_event_def MODIFY COLUMN default_channels VARCHAR(64) NOT NULL DEFAULT 'DINGTALK,EMAIL' COMMENT '默认通道（逗号分隔），如 DINGTALK,EMAIL,INAPP';
ALTER TABLE notification_event_def MODIFY COLUMN default_subscribed TINYINT(1) NOT NULL DEFAULT 1 COMMENT '默认订阅状态：0=默认关 / 1=默认开';
ALTER TABLE notification_event_def MODIFY COLUMN description VARCHAR(512) COMMENT '事件描述';
ALTER TABLE notification_event_def MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V22: notification_subscription 用户通知订阅
-- ===================================================================
ALTER TABLE notification_subscription COMMENT = '用户通知订阅表';

ALTER TABLE notification_subscription MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE notification_subscription MODIFY COLUMN user_id BIGINT NOT NULL COMMENT '用户 sys_user.id';
ALTER TABLE notification_subscription MODIFY COLUMN event_code VARCHAR(64) NOT NULL COMMENT '事件 notification_event_def.code';
ALTER TABLE notification_subscription MODIFY COLUMN channels VARCHAR(64) NOT NULL COMMENT '订阅通道（逗号分隔）';
ALTER TABLE notification_subscription MODIFY COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用：0=否 / 1=是';
ALTER TABLE notification_subscription MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- ===================================================================
-- V22: notification_log 通知发送轨迹
-- ===================================================================
ALTER TABLE notification_log COMMENT = '通知发送轨迹表（含重试退避）';

ALTER TABLE notification_log MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE notification_log MODIFY COLUMN tenant_id BIGINT COMMENT '所属租户 sys_tenant.id';
ALTER TABLE notification_log MODIFY COLUMN user_id BIGINT NOT NULL COMMENT '收件人 sys_user.id';
ALTER TABLE notification_log MODIFY COLUMN event_code VARCHAR(64) NOT NULL COMMENT '事件 notification_event_def.code';
ALTER TABLE notification_log MODIFY COLUMN channel VARCHAR(16) NOT NULL COMMENT '通道：DINGTALK / EMAIL / INAPP / SMS';
ALTER TABLE notification_log MODIFY COLUMN subject VARCHAR(256) COMMENT '标题';
ALTER TABLE notification_log MODIFY COLUMN body_text TEXT COMMENT '正文（纯文本）';
ALTER TABLE notification_log MODIFY COLUMN status ENUM('PENDING','SENT','FAILED','SKIPPED') NOT NULL COMMENT '发送状态：PENDING=待发送 / SENT=已发送 / FAILED=失败 / SKIPPED=跳过';
ALTER TABLE notification_log MODIFY COLUMN error_msg VARCHAR(1024) COMMENT '错误信息';
ALTER TABLE notification_log MODIFY COLUMN attempt_count INT NOT NULL DEFAULT 0 COMMENT '已尝试次数';
ALTER TABLE notification_log MODIFY COLUMN next_retry_at TIMESTAMP NULL COMMENT '下次重试时间';
ALTER TABLE notification_log MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';
ALTER TABLE notification_log MODIFY COLUMN sent_at TIMESTAMP NULL COMMENT '发送完成时间';

-- ===================================================================
-- V23: inapp_message 站内信收件箱
-- ===================================================================
ALTER TABLE inapp_message COMMENT = '站内信收件箱表（NotificationSendService.dispatch INAPP 分支落地）';

ALTER TABLE inapp_message MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE inapp_message MODIFY COLUMN tenant_id BIGINT NULL COMMENT '租户 ID（跨租户系统消息为 NULL）';
ALTER TABLE inapp_message MODIFY COLUMN user_id BIGINT NOT NULL COMMENT '收件人 sys_user.id';
ALTER TABLE inapp_message MODIFY COLUMN event_code VARCHAR(64) NOT NULL COMMENT '事件 notification_event_def.code';
ALTER TABLE inapp_message MODIFY COLUMN subject VARCHAR(256) NOT NULL COMMENT '标题（列表展示）';
ALTER TABLE inapp_message MODIFY COLUMN body_html TEXT NULL COMMENT '正文 HTML（详情展开）';
ALTER TABLE inapp_message MODIFY COLUMN body_text TEXT NULL COMMENT '正文纯文本（IM/钉钉降级时用）';
ALTER TABLE inapp_message MODIFY COLUMN link_url VARCHAR(512) NULL COMMENT '点击跳转链接（可选）';
ALTER TABLE inapp_message MODIFY COLUMN read_at TIMESTAMP NULL COMMENT '阅读时间，NULL = 未读';
ALTER TABLE inapp_message MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V23: password_reset_token 忘记密码 reset token
-- ===================================================================
ALTER TABLE password_reset_token COMMENT = '忘记密码 reset token 表（token 哈希存储，30min 过期）';

ALTER TABLE password_reset_token MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE password_reset_token MODIFY COLUMN user_id BIGINT NOT NULL COMMENT '关联 sys_user.id（无外键）';
ALTER TABLE password_reset_token MODIFY COLUMN token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 of raw token（原文只在邮件链接中出现一次）';
ALTER TABLE password_reset_token MODIFY COLUMN email VARCHAR(255) NOT NULL COMMENT '申请时的邮箱（防止用户中途改邮箱后旧 token 仍可用）';
ALTER TABLE password_reset_token MODIFY COLUMN expires_at TIMESTAMP NOT NULL COMMENT '过期时间，签发后 30min';
ALTER TABLE password_reset_token MODIFY COLUMN used_at TIMESTAMP NULL COMMENT '使用时间，NULL = 未使用';
ALTER TABLE password_reset_token MODIFY COLUMN requested_ip VARCHAR(64) NULL COMMENT '申请方 IP，审计用';
ALTER TABLE password_reset_token MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- ===================================================================
-- V24: audit_archive_log 审计日志月归档元数据
-- ===================================================================
ALTER TABLE audit_archive_log COMMENT = '审计日志月归档元数据表（位置/校验/状态）';

ALTER TABLE audit_archive_log MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键';
ALTER TABLE audit_archive_log MODIFY COLUMN archive_month CHAR(7) NOT NULL COMMENT 'YYYY-MM；归档窗口对应 sys_audit_log.created_at 月份';
ALTER TABLE audit_archive_log MODIFY COLUMN row_count BIGINT NOT NULL DEFAULT 0 COMMENT '归档行数';
ALTER TABLE audit_archive_log MODIFY COLUMN start_id BIGINT NULL COMMENT '归档起始 sys_audit_log.id';
ALTER TABLE audit_archive_log MODIFY COLUMN end_id BIGINT NULL COMMENT '归档结束 sys_audit_log.id';
ALTER TABLE audit_archive_log MODIFY COLUMN r2_bucket VARCHAR(128) NOT NULL COMMENT 'R2 bucket 名';
ALTER TABLE audit_archive_log MODIFY COLUMN r2_key VARCHAR(512) NOT NULL COMMENT 'R2 对象 key：audit-archive/YYYY/YYYY-MM.jsonl.gz.enc';
ALTER TABLE audit_archive_log MODIFY COLUMN bytes_compressed BIGINT NULL COMMENT 'gzip 压缩后 byte 数';
ALTER TABLE audit_archive_log MODIFY COLUMN bytes_encrypted BIGINT NULL COMMENT 'AES-GCM 加密后 byte 数（即上传体积）';
ALTER TABLE audit_archive_log MODIFY COLUMN sha256 CHAR(64) NULL COMMENT '加密 blob 的 SHA-256；RUNNING 时可空';
ALTER TABLE audit_archive_log MODIFY COLUMN iv_base64 VARCHAR(32) NULL COMMENT 'AesGcmUtil 把 IV 内嵌输出，本字段保留兼容外部解密';
ALTER TABLE audit_archive_log MODIFY COLUMN status ENUM('RUNNING','SUCCESS','FAILED') NOT NULL COMMENT '归档状态：RUNNING=进行中 / SUCCESS=成功 / FAILED=失败';
ALTER TABLE audit_archive_log MODIFY COLUMN error_msg VARCHAR(1024) NULL COMMENT '错误信息';
ALTER TABLE audit_archive_log MODIFY COLUMN started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间';
ALTER TABLE audit_archive_log MODIFY COLUMN finished_at TIMESTAMP NULL COMMENT '结束时间';
