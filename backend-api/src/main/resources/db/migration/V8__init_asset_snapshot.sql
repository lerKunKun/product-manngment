-- ============================================
-- V8: 资产快照相关表（asset_snapshot / asset_file）
-- Track A Python worker 拉取 Shopify 主题/政策/产品后写入 R2，并在此处登记元数据
-- 对应 W2-AST-01
-- ============================================

CREATE TABLE IF NOT EXISTS asset_snapshot (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）',
    store_id BIGINT NOT NULL COMMENT '关联 store.id',
    snapshot_type ENUM('THEME', 'POLICY', 'MENU', 'COLLECTION', 'PRODUCT', 'FULL') NOT NULL COMMENT '快照类型',
    status ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '快照状态',
    r2_prefix VARCHAR(256) NOT NULL COMMENT 'R2 对象前缀，例如 tenants/1/stores/3/snapshots/42/',
    manifest_json LONGTEXT NULL COMMENT '清单 JSON（文件列表/校验信息）',
    file_count INT NOT NULL DEFAULT 0 COMMENT '文件总数',
    total_bytes BIGINT NOT NULL DEFAULT 0 COMMENT '总字节数',
    error_message TEXT NULL COMMENT '失败原因',
    triggered_by BIGINT NULL COMMENT 'sys_user.id 触发者；定时任务为 NULL',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL COMMENT '开始执行时间',
    completed_at TIMESTAMP NULL COMMENT '完成时间',
    deleted_at TIMESTAMP NULL,
    INDEX idx_store_status (store_id, status),
    INDEX idx_tenant_type_created (tenant_id, snapshot_type, created_at),
    INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资产快照主表';

CREATE TABLE IF NOT EXISTS asset_file (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    snapshot_id BIGINT NOT NULL COMMENT '关联 asset_snapshot.id',
    relative_path VARCHAR(512) NOT NULL COMMENT '相对路径，例如 templates/index.json',
    r2_key VARCHAR(512) NOT NULL COMMENT 'R2 对象完整 key',
    size_bytes BIGINT NOT NULL COMMENT '文件字节数',
    content_type VARCHAR(128) NULL COMMENT 'MIME 类型',
    sha256 CHAR(64) NULL COMMENT '文件 SHA256 摘要',
    downloaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下载落 R2 时间',
    INDEX idx_snapshot_path (snapshot_id, relative_path),
    INDEX idx_snapshot_id (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资产快照文件清单';
