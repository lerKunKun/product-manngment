-- ============================================
-- V5: 全平台产品库表（按 Shopify 42 列 CSV 模板对齐）
-- 对应《系统设计文档》6.2 节
-- ============================================

CREATE TABLE IF NOT EXISTS product (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    owner_company_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）',
    owner_dept_id BIGINT NULL,
    handle VARCHAR(255) NOT NULL UNIQUE COMMENT '全平台唯一匹配键',
    title VARCHAR(512) NOT NULL,
    body_html MEDIUMTEXT,
    vendor VARCHAR(255),
    product_category VARCHAR(255),
    type VARCHAR(255),
    tags VARCHAR(1024),
    published TINYINT(1) NOT NULL DEFAULT 1,
    seo_title VARCHAR(255),
    seo_description VARCHAR(1024),
    status ENUM('active', 'draft', 'archived') NOT NULL DEFAULT 'draft',
    created_by BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    INDEX idx_owner_company (owner_company_id, owner_dept_id),
    INDEX idx_handle (handle),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品主表';

CREATE TABLE IF NOT EXISTS product_option (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL COMMENT 'Option1 Name / Option2 Name / Option3 Name',
    position INT NOT NULL DEFAULT 1,
    linked_to VARCHAR(255) NULL COMMENT 'Option Linked To',
    INDEX idx_product (product_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品选项';

CREATE TABLE IF NOT EXISTS product_variant (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    sku VARCHAR(255),
    position INT NOT NULL DEFAULT 1,
    option1 VARCHAR(255),
    option2 VARCHAR(255),
    option3 VARCHAR(255),
    grams DECIMAL(10, 2) DEFAULT 0,
    weight_unit VARCHAR(16) DEFAULT 'g',
    inventory_tracker VARCHAR(64) COMMENT 'shopify / null',
    inventory_qty INT DEFAULT 0,
    inventory_policy ENUM('deny', 'continue') NOT NULL DEFAULT 'continue',
    fulfillment_service VARCHAR(64) DEFAULT 'manual',
    price DECIMAL(12, 2) NOT NULL DEFAULT 0,
    compare_at_price DECIMAL(12, 2),
    requires_shipping TINYINT(1) NOT NULL DEFAULT 1,
    taxable TINYINT(1) NOT NULL DEFAULT 1,
    barcode VARCHAR(128),
    unit_price_total_measure DECIMAL(12, 4),
    unit_price_total_measure_unit VARCHAR(32),
    unit_price_base_measure DECIMAL(12, 4),
    unit_price_base_measure_unit VARCHAR(32),
    variant_image VARCHAR(1024),
    tax_code VARCHAR(64),
    cost_per_item DECIMAL(12, 2),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    INDEX idx_product (product_id),
    INDEX idx_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品变体';

CREATE TABLE IF NOT EXISTS product_image (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    src VARCHAR(1024) NOT NULL,
    position INT NOT NULL DEFAULT 1,
    alt_text VARCHAR(512),
    gift_card TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_product (product_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品图片';

CREATE TABLE IF NOT EXISTS product_metafield (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    `namespace` VARCHAR(64) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    value TEXT,
    type VARCHAR(64),
    INDEX idx_product (product_id),
    INDEX idx_ns_key (`namespace`, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品 metafields';

CREATE TABLE IF NOT EXISTS product_external_link (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    kind ENUM('AD', 'BENCHMARK', 'MATERIAL') NOT NULL COMMENT '广告贴 / 对标页 / 产品素材',
    url VARCHAR(1024) NOT NULL,
    note VARCHAR(512),
    created_by BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_product (product_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品外部链接（广告/对标/素材）';

CREATE TABLE IF NOT EXISTS file_sign_token (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    scope_keys JSON NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_count INT NOT NULL DEFAULT 0,
    max_uses INT NOT NULL DEFAULT 1000,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件签名 token（折中方案 B）';
