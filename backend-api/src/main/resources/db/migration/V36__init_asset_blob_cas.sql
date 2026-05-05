-- ============================================
-- V36: 资产 CAS（Content-Addressable Storage）去重层
-- Track AS2 — 评估文档 §2.2 / §3
--
-- 目标：把"按 snapshot 的整份副本"重构成"按内容寻址的 blob 仓库 + 每 snapshot 的 manifest"。
-- 同主题、同图在同一 tenant 下的多店 / 多 snapshot 间只存一份字节。
--
-- 兼容性说明：
-- 1. asset_file 既有的 sha256 列保留（旧数据），新增 blob_sha256 引用 CAS blob。
--    新写入路径会两列同时填（值相同）；老数据 blob_sha256 留 NULL，等 follow-up 回填脚本。
-- 2. asset_file.r2_key 保留以兼容 V8 既有数据；新写入路径中 r2_key 仍指向 CAS 物理 key
--    （tenants/{tid}/cas/{sha[:2]}/{sha}），manifest_key 由 asset_snapshot.r2_prefix 推断。
-- 3. asset_blob.ref_count 仅作为统计 / GC 依据；当前 worker 写入路径不维护引用计数，
--    回填 + 计数维护任务在 follow-up（详见 worker cas_storage.put_or_link 注释）。
-- ============================================

CREATE TABLE IF NOT EXISTS asset_blob (
    sha256 CHAR(64) NOT NULL COMMENT 'blob 字节的 SHA-256 十六进制摘要',
    size_bytes BIGINT NOT NULL COMMENT '字节数',
    content_type VARCHAR(128) NULL COMMENT 'MIME 类型；可空',
    tenant_id BIGINT NOT NULL COMMENT '所属分公司（CAS 按 tenant 隔离）',
    first_seen_at DATETIME NOT NULL COMMENT '首次入库时间',
    ref_count INT NOT NULL DEFAULT 0 COMMENT '引用计数（manifest 引用数；follow-up 回填）',
    PRIMARY KEY (sha256),
    INDEX idx_tenant (tenant_id),
    INDEX idx_first_seen (first_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资产 CAS blob 元数据（content-addressable）';

ALTER TABLE asset_file
    ADD COLUMN blob_sha256 CHAR(64) NULL COMMENT 'CAS blob 引用（asset_blob.sha256）；老数据 NULL' AFTER r2_key,
    ADD INDEX idx_blob_sha (blob_sha256);
