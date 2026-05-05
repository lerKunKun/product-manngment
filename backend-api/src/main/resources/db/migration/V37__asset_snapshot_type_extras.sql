-- ============================================
-- V37: asset_snapshot.snapshot_type 增加 SHOP_SETTINGS / FILE_LIBRARY / METAFIELD 枚举值（AS3-04）
--
-- Track AS3 — 评估文档 §3：补齐资产覆盖（店铺设置 / Files 库 / metafields）。
-- 这三类资产由新加的 worker 端 /pull/shop_settings、/pull/files、/pull/metafields
-- 拉取，SyncConsumer 在 FULL 流程里串行调用。
--
-- 兼容性：
-- 1. 严格保留 V8 + V25 + V35 已有的全部值（THEME/POLICY/MENU/COLLECTION/PRODUCT/FULL）。
-- 2. snapshot_type 在 entity 中映射为 String，不需要 Java 端改动。
-- 3. 不重命名、不删除已有值，只是扩 ENUM。
-- ============================================
ALTER TABLE asset_snapshot
    MODIFY COLUMN snapshot_type
        ENUM('THEME', 'POLICY', 'MENU', 'COLLECTION', 'PRODUCT', 'FULL',
             'SHOP_SETTINGS', 'FILE_LIBRARY', 'METAFIELD')
        NOT NULL COMMENT '快照类型';
