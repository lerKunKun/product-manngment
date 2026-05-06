-- ============================================
-- V38: 快照 diff 缓存
-- Track AS4 — 评估文档 §2.3 / §3
--
-- 目标：跨店 / 历史快照对比 — manifest 层 / 内容层 diff 计算结果落表，
-- 命中即返回，避免每次重新拉 manifest + 文本 diff。
--
-- 一对 (snapshotA, snapshotB) + scope 唯一；scope 取值：
--   "manifest" — manifest 一层（按 relative_path 左外连接 → ADDED/REMOVED/MODIFIED）
--   "theme" / "products" / ... — 内容层按 category 缓存（暂未启用）
-- ============================================

CREATE TABLE IF NOT EXISTS snapshot_diff_cache (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    snapshot_a_id BIGINT NOT NULL COMMENT '左侧快照 id（asset_snapshot.id）',
    snapshot_b_id BIGINT NOT NULL COMMENT '右侧快照 id',
    scope VARCHAR(64) NOT NULL COMMENT 'manifest / theme / products / ...',
    result_json LONGTEXT NOT NULL COMMENT 'diff 结果 JSON（DiffSummary + DiffChange[]）',
    computed_at DATETIME NOT NULL COMMENT '本次计算完成时间',
    UNIQUE KEY uk_pair_scope (snapshot_a_id, snapshot_b_id, scope),
    INDEX idx_a (snapshot_a_id),
    INDEX idx_b (snapshot_b_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='跨店/历史快照 diff 缓存（AS4）';
