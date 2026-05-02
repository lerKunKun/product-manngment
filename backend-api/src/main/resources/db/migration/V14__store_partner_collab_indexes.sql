-- ============================================
-- V14: W3-PV-01 合作者店铺池索引
-- store.is_dev_store / is_partner_collab 列在 V4__init_store.sql 已存在；
-- 本迁移仅补充按 (is_partner_collab,status) / (is_dev_store,status) 的复合索引，
-- 让 GET /store?partnerCollab=...&devStore=... 与 /store/pool/partner-collab 可走索引。
-- ============================================

-- MySQL 8 不支持 IF NOT EXISTS for CREATE INDEX；用动态 SQL 兜底重复执行。
SET @schema_db := DATABASE();

SET @idx_partner_exists := (
    SELECT COUNT(1) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @schema_db AND TABLE_NAME = 'store' AND INDEX_NAME = 'idx_store_partner_collab'
);
SET @sql_partner := IF(@idx_partner_exists = 0,
    'CREATE INDEX idx_store_partner_collab ON store (is_partner_collab, status)',
    'SELECT 1');
PREPARE stmt FROM @sql_partner; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_dev_exists := (
    SELECT COUNT(1) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @schema_db AND TABLE_NAME = 'store' AND INDEX_NAME = 'idx_store_dev_store'
);
SET @sql_dev := IF(@idx_dev_exists = 0,
    'CREATE INDEX idx_store_dev_store ON store (is_dev_store, status)',
    'SELECT 1');
PREPARE stmt FROM @sql_dev; EXECUTE stmt; DEALLOCATE PREPARE stmt;
