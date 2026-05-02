-- ============================================
-- V24: W4-OPS-01 审计日志月归档元数据表
-- 对应 Wave 4 G4 track。
-- 设计要点：
--   - sys_audit_log 上上月数据每月 1 号 02:30 由 AuditArchiveScheduler 归档为
--     audit-archive/YYYY/YYYY-MM.jsonl.gz.enc（gzip + AES-256-GCM）。
--   - audit_archive_log 仅存归档元数据（位置/校验/状态），不存原始审计行。
--   - 上传 + SHA-256 校验通过后才物理删 sys_audit_log 中归档月数据。
-- ============================================

CREATE TABLE IF NOT EXISTS audit_archive_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    archive_month CHAR(7) NOT NULL COMMENT 'YYYY-MM；归档窗口对应 sys_audit_log.created_at 月份',
    row_count BIGINT NOT NULL DEFAULT 0,
    start_id BIGINT NULL,
    end_id BIGINT NULL,
    r2_bucket VARCHAR(128) NOT NULL,
    r2_key VARCHAR(512) NOT NULL COMMENT 'audit-archive/YYYY/YYYY-MM.jsonl.gz.enc',
    bytes_compressed BIGINT NULL COMMENT 'gzip 压缩后 byte 数',
    bytes_encrypted BIGINT NULL COMMENT 'AES-GCM 加密后 byte 数（即上传体积）',
    sha256 CHAR(64) NULL COMMENT '加密 blob 的 SHA-256；RUNNING 时可空',
    iv_base64 VARCHAR(32) NULL COMMENT 'AesGcmUtil 把 IV 内嵌输出，本字段保留兼容外部解密',
    status ENUM('RUNNING','SUCCESS','FAILED') NOT NULL,
    error_msg VARCHAR(1024) NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    UNIQUE KEY uk_archive_month (archive_month),
    INDEX idx_status_started (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审计日志月归档元数据 (W4-OPS-01)';
