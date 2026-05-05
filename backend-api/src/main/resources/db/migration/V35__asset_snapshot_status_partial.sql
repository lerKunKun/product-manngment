-- ============================================
-- V35: asset_snapshot.status 增加 PARTIAL 枚举值（AS1-06）
-- 用于 SyncConsumer 串行调多个 worker pull endpoint 时，
-- 一成一败场景下记录"部分成功"。
-- 与 task.status 现有 PARTIAL 风格保持一致。
-- ============================================
ALTER TABLE asset_snapshot
    MODIFY COLUMN status ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED', 'PARTIAL')
    NOT NULL DEFAULT 'PENDING' COMMENT '快照状态';
