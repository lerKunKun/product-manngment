-- ============================================
-- V43: 资产快照 entries 平铺索引表（asset_snapshot_entry）
--
-- 现有 /asset-snapshot/{id}/manifests 端点每次都从 R2 拉所有 segment manifest.json
-- 一次性返回全集给前端做客户端分页/分类，单店铺主题 + 文件库可以到 1-2 万条 entry，
-- HTTP response 10-20MB、内存全 hold —— 文件量上来后是个真瓶颈。
--
-- 这表把 manifest 里的 entries 平铺到 MySQL（首次访问新端点时从 R2 懒填充），
-- 后续分页/分类/段过滤都走标准 SQL + 索引，response 只含当前页。
--
-- category 是后端 ingest 时按路径+MIME 算的类别（theme / image / video / font /
-- data / other），与前端 classify() 规则一致；冗余但避免每个请求都重算。
-- ============================================

CREATE TABLE asset_snapshot_entry (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    snapshot_id BIGINT NOT NULL COMMENT '关联 asset_snapshot.id',
    segment VARCHAR(32) NOT NULL COMMENT 'theme / product / shop_settings / metafields / files / menu / policy / collection',
    relative_path VARCHAR(1024) NOT NULL COMMENT 'manifest entry 的 relative_path',
    sha256 CHAR(64) NULL COMMENT 'manifest entry 的 sha256；CAS 内容寻址用',
    size BIGINT NULL COMMENT 'manifest entry 的 size（字节）',
    content_type VARCHAR(128) NULL COMMENT 'manifest entry 的 content_type（MIME）',
    category VARCHAR(16) NOT NULL COMMENT 'theme / image / video / font / data / other（ingest 时算好）',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'ingest 时间',
    INDEX idx_snapshot_category (snapshot_id, category),
    INDEX idx_snapshot_segment (snapshot_id, segment),
    INDEX idx_snapshot_id (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资产快照 entries 索引（懒填充自 R2 manifest，加速分页/分类查询）';
