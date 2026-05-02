-- ============================================
-- V4: 店铺接入相关表
-- 设计文档第 6.3 节租户库 store/store_webhook 表的简化版（Wave 1 暂落 platform 库，Wave 2 迁 tenant_xx）
-- ============================================

CREATE TABLE IF NOT EXISTS store (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）',
    dept_id BIGINT NULL,
    myshopify_domain VARCHAR(128) NOT NULL COMMENT 'xxx.myshopify.com',
    custom_domain VARCHAR(128) NULL COMMENT '自定义域名',
    brand_name VARCHAR(128) NULL,

    -- Token：cli / custom_app / oauth
    token_type ENUM('cli', 'custom_app', 'oauth') NOT NULL,
    encrypted_access_token VARCHAR(1024) NOT NULL COMMENT 'AES-GCM 加密入库',
    encrypted_refresh_token VARCHAR(1024) NULL,
    expires_at TIMESTAMP NULL COMMENT 'oauth/cli 过期时间；custom_app 永不过期 = NULL',
    scopes JSON NULL,
    last_refresh_at TIMESTAMP NULL,

    is_dev_store TINYINT(1) NOT NULL DEFAULT 0,
    is_partner_collab TINYINT(1) NOT NULL DEFAULT 0,

    status ENUM('ACTIVE', 'DISABLED', 'TOKEN_EXPIRED', 'UNINSTALLED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uk_myshopify_domain (myshopify_domain),
    INDEX idx_tenant (tenant_id, status),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='店铺接入表';

CREATE TABLE IF NOT EXISTS store_webhook (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    store_id BIGINT NOT NULL,
    topic VARCHAR(64) NOT NULL,
    callback_url VARCHAR(512) NOT NULL,
    shopify_id VARCHAR(64),
    status ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_store_topic (store_id, topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='店铺 Webhook 注册';

CREATE TABLE IF NOT EXISTS oauth_session (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(64) NOT NULL UNIQUE,
    store_domain VARCHAR(128) NOT NULL,
    scope VARCHAR(512),
    state_hmac VARCHAR(128) NOT NULL,
    status ENUM('PENDING', 'COMPLETED', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    initiated_by BIGINT NOT NULL,
    initiated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    INDEX idx_session_id (session_id),
    INDEX idx_initiated_at (initiated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OAuth 临时 session（10 分钟过期）';
