-- ============================================
-- V9: 产品快照与价格/库存变更历史
-- 支持 Webhook/手动/定时/推送后触发的产品快照（CSV+JSON 落 R2），
-- 以及 variant 维度的价格、库存变更明细（按月分区）
-- 对应 W2-SNAP-01
-- ============================================

CREATE TABLE IF NOT EXISTS product_snapshot (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）',
    store_id BIGINT NOT NULL COMMENT '关联 store.id',
    product_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify 产品 GID 或数字 id',
    product_id BIGINT NULL COMMENT '若已映射到平台 product.id 则填写',
    trigger_event ENUM('WEBHOOK_UPDATE', 'MANUAL', 'SCHEDULE', 'PUSH_DONE') NOT NULL COMMENT '触发来源',
    status ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '快照状态',
    csv_r2_key VARCHAR(512) NULL COMMENT '导出的 42 列 CSV 在 R2 的 key',
    json_r2_key VARCHAR(512) NULL COMMENT '完整 Shopify JSON dump 在 R2 的 key',
    diff_summary_json TEXT NULL COMMENT '差异摘要 JSON：{"changed_fields":[...],"field_count":N}',
    total_bytes BIGINT NOT NULL DEFAULT 0 COMMENT '总字节数（CSV+JSON）',
    error_message TEXT NULL COMMENT '失败原因',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL COMMENT '完成时间',
    deleted_at TIMESTAMP NULL,
    INDEX idx_store_product (store_id, product_external_id, created_at),
    INDEX idx_tenant_created (tenant_id, created_at),
    INDEX idx_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品快照主表';

-- product_price_history：按 changed_at 月份分区
-- 注：MySQL 要求分区键必须是所有 UNIQUE/PK 的一部分，故主键改为 (id, changed_at)；
-- id 仍保留 AUTO_INCREMENT 唯一自增。
CREATE TABLE IF NOT EXISTS product_price_history (
    id BIGINT NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id',
    store_id BIGINT NOT NULL COMMENT '关联 store.id',
    product_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify 产品 GID/数字 id',
    variant_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify variant GID/数字 id',
    price DECIMAL(15, 4) NOT NULL COMMENT '变更后价格',
    compare_at_price DECIMAL(15, 4) NULL COMMENT '划线价',
    old_price DECIMAL(15, 4) NULL COMMENT '变更前价格（用于 diff）',
    currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT '币种 ISO 4217',
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间（分区键，使用 DATETIME 以支持分区表达式）',
    source ENUM('WEBHOOK', 'MANUAL', 'PUSH') NOT NULL DEFAULT 'WEBHOOK' COMMENT '变更来源',
    PRIMARY KEY (id, changed_at),
    INDEX idx_variant_changed (store_id, variant_external_id, changed_at),
    INDEX idx_tenant_changed (tenant_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品 variant 价格变更历史（按月分区）'
PARTITION BY RANGE (TO_DAYS(changed_at)) (
    PARTITION p202605 VALUES LESS THAN (740133),  -- TO_DAYS('2026-06-01')
    PARTITION p202606 VALUES LESS THAN (740163),  -- TO_DAYS('2026-07-01')
    PARTITION p202607 VALUES LESS THAN (740194),  -- TO_DAYS('2026-08-01')
    PARTITION p202608 VALUES LESS THAN (740225),  -- TO_DAYS('2026-09-01')
    PARTITION p202609 VALUES LESS THAN (740255),  -- TO_DAYS('2026-10-01')
    PARTITION p202610 VALUES LESS THAN (740286),  -- TO_DAYS('2026-11-01')
    PARTITION p202611 VALUES LESS THAN (740316),  -- TO_DAYS('2026-12-01')
    PARTITION p202612 VALUES LESS THAN (740347),  -- TO_DAYS('2027-01-01')
    PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- product_inventory_history：按 changed_at 月份分区，与价格历史同模式
CREATE TABLE IF NOT EXISTS product_inventory_history (
    id BIGINT NOT NULL AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id',
    store_id BIGINT NOT NULL COMMENT '关联 store.id',
    product_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify 产品 GID/数字 id',
    variant_external_id VARCHAR(64) NOT NULL COMMENT 'Shopify variant GID/数字 id',
    inventory_quantity INT NOT NULL COMMENT '变更后库存数量',
    old_quantity INT NULL COMMENT '变更前库存数量（用于 diff）',
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间（分区键，使用 DATETIME 以支持分区表达式）',
    source ENUM('WEBHOOK', 'MANUAL', 'PUSH') NOT NULL DEFAULT 'WEBHOOK' COMMENT '变更来源',
    PRIMARY KEY (id, changed_at),
    INDEX idx_variant_changed (store_id, variant_external_id, changed_at),
    INDEX idx_tenant_changed (tenant_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品 variant 库存变更历史（按月分区）'
PARTITION BY RANGE (TO_DAYS(changed_at)) (
    PARTITION p202605 VALUES LESS THAN (740133),  -- TO_DAYS('2026-06-01')
    PARTITION p202606 VALUES LESS THAN (740163),  -- TO_DAYS('2026-07-01')
    PARTITION p202607 VALUES LESS THAN (740194),  -- TO_DAYS('2026-08-01')
    PARTITION p202608 VALUES LESS THAN (740225),  -- TO_DAYS('2026-09-01')
    PARTITION p202609 VALUES LESS THAN (740255),  -- TO_DAYS('2026-10-01')
    PARTITION p202610 VALUES LESS THAN (740286),  -- TO_DAYS('2026-11-01')
    PARTITION p202611 VALUES LESS THAN (740316),  -- TO_DAYS('2026-12-01')
    PARTITION p202612 VALUES LESS THAN (740347),  -- TO_DAYS('2027-01-01')
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
