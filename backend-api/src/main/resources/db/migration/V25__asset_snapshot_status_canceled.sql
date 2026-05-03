-- ============================================
-- V25: asset_snapshot.status 增加 CANCELED 枚举值（T22）
-- 与 task.status / approval cancel 风格保持一致：CANCELED（单 L）
-- ============================================
ALTER TABLE asset_snapshot
    MODIFY COLUMN status ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED')
    NOT NULL DEFAULT 'PENDING' COMMENT '快照状态';
