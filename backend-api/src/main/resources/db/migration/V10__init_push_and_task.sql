-- ============================================
-- V10: 推送（Push）相关表 + 通用任务（task）表
-- store_product / store_product_variant：内部产品/变体 → 各店铺 Shopify 产品/变体的映射
-- task：所有异步任务的统一登记（PUSH/PULL/SNAPSHOT/PREVIEW/SAGA 等）
-- push_conflict：推送过程中的 handle/sku 冲突，等待用户决策
-- 对应 W2-PUSH-01
-- 注：按本仓库约定不建外键约束（FK），仅以索引体现关联
-- ============================================

CREATE TABLE IF NOT EXISTS store_product (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id（COMPANY 节点）',
    store_id BIGINT NOT NULL COMMENT '关联 store.id',
    product_id BIGINT NOT NULL COMMENT '内部 product.id（平台侧产品主表）',
    shopify_product_id VARCHAR(64) NULL COMMENT 'Shopify 产品 id（数字或 GID），未推送前为 NULL',
    shopify_handle VARCHAR(255) NULL COMMENT 'Shopify 实际 handle（可能与 product.handle 不同，发生重命名时）',
    status ENUM('NOT_PUSHED', 'PUSHING', 'ACTIVE', 'DRAFT', 'ARCHIVED', 'FAILED') NOT NULL DEFAULT 'NOT_PUSHED' COMMENT '推送状态',
    last_push_task_id BIGINT NULL COMMENT '最近一次推送任务 task.id（无外键）',
    last_pushed_at TIMESTAMP NULL COMMENT '最近一次推送完成时间',
    last_pulled_at TIMESTAMP NULL COMMENT '最近一次回拉时间（PUSH_DONE / 手动拉取）',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uk_store_product (store_id, product_id),
    INDEX idx_shopify_product (store_id, shopify_product_id),
    INDEX idx_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='内部产品 → 店铺 Shopify 产品映射';

CREATE TABLE IF NOT EXISTS store_product_variant (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    store_product_id BIGINT NOT NULL COMMENT '关联 store_product.id',
    product_variant_id BIGINT NOT NULL COMMENT '内部 product_variant.id',
    shopify_variant_id VARCHAR(64) NULL COMMENT 'Shopify variant id（数字或 GID）',
    sku VARCHAR(128) NULL COMMENT '推送时使用的 SKU（用于冲突诊断）',
    shopify_inventory_item_id VARCHAR(64) NULL COMMENT 'Shopify inventory_item id（用于库存上架/调整）',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uk_storeprod_var (store_product_id, product_variant_id),
    INDEX idx_shopify_variant (shopify_variant_id),
    INDEX idx_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='内部 variant → 店铺 Shopify variant 映射';

CREATE TABLE IF NOT EXISTS task (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL COMMENT '所属分公司 sys_org.id',
    type ENUM('PRODUCT_PUSH', 'PRODUCT_PULL', 'THEME_PULL', 'POLICY_PULL', 'MENU_PULL', 'COLLECTION_PULL', 'SNAPSHOT', 'PREVIEW', 'NEW_STORE_SAGA', 'OTHER') NOT NULL COMMENT '任务类型',
    status ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL', 'CANCELED') NOT NULL DEFAULT 'PENDING' COMMENT '任务状态',
    store_id BIGINT NULL COMMENT '关联 store.id（部分任务无关联）',
    payload_json LONGTEXT NULL COMMENT '请求体 / 参数 JSON',
    result_json LONGTEXT NULL COMMENT '响应 / 累计结果 JSON',
    error_message TEXT NULL COMMENT '失败原因',
    triggered_by BIGINT NULL COMMENT '触发者 sys_user.id；定时任务为 NULL',
    parent_task_id BIGINT NULL COMMENT 'SAGA 父任务 task.id（无外键）',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL COMMENT '开始执行时间',
    completed_at TIMESTAMP NULL COMMENT '完成时间',
    deleted_at TIMESTAMP NULL,
    INDEX idx_tenant_type_created (tenant_id, type, created_at),
    INDEX idx_status_created (status, created_at),
    INDEX idx_parent (parent_task_id),
    INDEX idx_store (store_id, type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='通用异步任务登记（push/pull/snapshot/preview/saga 等）';

CREATE TABLE IF NOT EXISTS push_conflict (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id BIGINT NOT NULL COMMENT '关联 task.id（无外键）',
    product_id BIGINT NOT NULL COMMENT '内部 product.id',
    store_id BIGINT NOT NULL COMMENT '关联 store.id',
    conflict_type ENUM('HANDLE_TAKEN', 'SKU_DUPLICATE', 'VARIANT_OPTION_MISMATCH', 'OTHER') NOT NULL COMMENT '冲突类型',
    detail_json TEXT NULL COMMENT '冲突详情 JSON：{existing_product_id, conflicting_handle, ...}',
    status ENUM('PENDING', 'RESOLVED_OVERWRITE', 'RESOLVED_RENAME', 'RESOLVED_SKIP', 'EXPIRED') NOT NULL DEFAULT 'PENDING' COMMENT '冲突解决状态',
    resolution_payload_json TEXT NULL COMMENT '用户决策附带数据 JSON',
    resolved_by BIGINT NULL COMMENT '解决者 sys_user.id',
    resolved_at TIMESTAMP NULL COMMENT '解决时间',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    INDEX idx_task (task_id),
    INDEX idx_status_created (status, created_at),
    INDEX idx_store_product (store_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='推送冲突登记（handle/sku 等待用户决策）';
