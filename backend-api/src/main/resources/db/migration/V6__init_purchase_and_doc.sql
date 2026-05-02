-- ============================================
-- V6: 采购管理 + 产品媒体/需求文档
-- 对应《系统设计文档》6.2 节 W3-PUR / W3-MED 提前实现的简化版
-- ============================================

CREATE TABLE IF NOT EXISTS purchase_info (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    variant_id BIGINT NOT NULL COMMENT '一对一变体；改 SKU 时联动 product_variant.sku',
    purchase_url VARCHAR(1024) COMMENT '采购链接（如 1688）',
    cost DECIMAL(12, 2) COMMENT '采购成本',
    currency VARCHAR(8) DEFAULT 'CNY',
    gross_weight DECIMAL(10, 2) COMMENT '克重（含包装）',
    weight_unit VARCHAR(8) DEFAULT 'g',
    logistics_tags JSON COMMENT '物流标注 tag：液体/带电/液体充电等 string 列表',
    note VARCHAR(1024),
    updated_by BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uk_variant (variant_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购信息（变体级）';

CREATE TABLE IF NOT EXISTS sku_change_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    variant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    old_sku VARCHAR(255),
    new_sku VARCHAR(255) NOT NULL,
    changed_by BIGINT NOT NULL,
    confirmed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sync_status ENUM('PENDING', 'SUCCESS', 'PARTIAL', 'FAILED') NOT NULL DEFAULT 'PENDING',
    sync_result JSON,
    INDEX idx_variant (variant_id),
    INDEX idx_changed_by (changed_by, confirmed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SKU 变更审计日志';

CREATE TABLE IF NOT EXISTS product_doc (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    type ENUM('RICH_TEXT', 'FILE') NOT NULL,
    -- RICH_TEXT 模式：TipTap JSON
    rich_text_json JSON NULL,
    -- FILE 模式：R2 对象 + 元信息
    file_r2_key VARCHAR(512) NULL,
    file_url VARCHAR(1024) NULL,
    file_name VARCHAR(255) NULL,
    file_size BIGINT NULL,
    file_mime VARCHAR(128) NULL,
    title VARCHAR(255) COMMENT '文档标题，便于列表展示',
    sort INT NOT NULL DEFAULT 0,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    INDEX idx_product (product_id, sort)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品媒体/需求文档';
