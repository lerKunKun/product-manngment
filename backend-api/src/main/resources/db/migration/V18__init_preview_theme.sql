-- ============================================
-- V18: W3-PV-03 + W3-PV-06 预览主题表（合作者 dev store 池）
-- preview_theme：用户在产品详情点 👁 时，分配一个 partner-collab dev store + 创建一个临时主题，
--                worker (W3-PV-04) 异步把产品 + 主题落到 Shopify 后回填 shopify_theme_id / preview_url。
-- 24 小时自动过期；同一 dev store 至多 3 个活跃 preview。
-- 注：按本仓库约定不建外键约束（FK），仅以索引体现关联。
-- ============================================

CREATE TABLE IF NOT EXISTS preview_theme (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL COMMENT '申请者所在 tenant.id（用于多租户隔离）',
    source_product_id BIGINT NOT NULL COMMENT '我们内部 product.id（被预览的产品）',
    dev_store_id BIGINT NOT NULL COMMENT '选中的 partner-collab dev store.id（无外键）',
    shopify_theme_id VARCHAR(64) NULL COMMENT 'Worker 在 Shopify 创建的 theme id；初始 null，PV-04 worker 落地后填',
    preview_url VARCHAR(512) NULL COMMENT 'Shopify 主题预览 URL；初始 null，PV-04 worker 落地后填',
    status ENUM('PENDING', 'BUILDING', 'READY', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '预览主题生命周期状态',
    last_accessed_at TIMESTAMP NULL COMMENT '最近一次用户点击预览链接的时间（前端 /preview/{id}/accessed 上报）',
    expires_at TIMESTAMP NULL COMMENT '硬过期时间（默认 created_at + 24h），cleanup cron 据此清理',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（分配时刻）',
    completed_at TIMESTAMP NULL COMMENT 'Worker 把 theme 落到 Shopify 完成的时间（status=READY 时填）',
    error_message TEXT NULL COMMENT 'status=FAILED 时的错误描述',
    deleted_at TIMESTAMP NULL COMMENT '软删除时间（@TableLogic）；cleanup cron 经此路径回收',
    INDEX idx_preview_dev_store_status (dev_store_id, status, created_at),
    INDEX idx_preview_product (source_product_id, status),
    INDEX idx_preview_expires (expires_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Shopify 预览主题分配表（W3-PV-03/PV-06）';
