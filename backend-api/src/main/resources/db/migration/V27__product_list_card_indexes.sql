-- ============================================
-- V27: 产品列表"卡片化"列改造（首图 / 价格 / 已上架店铺数）配套索引
--
-- 背景：列表页每页 20 条产品，渲染时需要 3 类聚合：
--   1) 主图   = product_image WHERE product_id IN (...) AND position = 1
--      已有 idx_product (product_id, position) 命中前缀，无需新增。
--   2) 起价   = product_variant WHERE product_id IN (...)（取 MIN(price)）
--      已有 idx_product (product_id) 命中前缀，无需新增。
--   3) 已上架店铺数 = store_product WHERE product_id IN (...) AND status = 'ACTIVE'
--      现有索引：
--        uk_store_product               (store_id, product_id)        — product_id 不在前缀
--        idx_shopify_product            (store_id, shopify_product_id)
--        idx_tenant_status              (tenant_id, status)
--        idx_storeprod_tenant_status_updated (tenant_id, status, updated_at)  — V20 加
--      没有任何索引以 product_id 为前缀，按 product_id 聚合走全表扫。
--      列表页每次刷新 = 1 次全表扫 store_product，租户产品多/店铺多时会立刻劣化。
--
-- 因此补一个 (product_id, status) 复合索引：
--   - 命中点查 WHERE product_id = ? AND status = 'ACTIVE'
--   - 命中批量 WHERE product_id IN (?,?,...) AND status = 'ACTIVE'（IN 最多 20 个）
--   - 用 status 当二列既能直接覆盖 ACTIVE 过滤，又能给未来"按状态分桶统计"复用
-- ============================================

CREATE INDEX idx_storeprod_product_status
    ON store_product (product_id, status);
