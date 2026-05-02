-- W3-DS-01：跨公司授权扩展（时效必填）
--
-- 既有列（V1__init_platform.sql）：
--   id / user_id / scope_type / scope_id / access / granted_by / granted_at /
--   expires_at(NOT NULL) / approval_id / source(ENUM CROSS_AUTH/INVITATION) / status / created_at
-- 已有索引：idx_user_status (user_id,status), idx_expires_at (expires_at)
--
-- 本迁移补三列：cross_company / revoked_at / granter_company_id
--   - granted_by / expires_at 在 V1 已存在，跳过
--   - source 已是 ENUM('CROSS_AUTH','INVITATION')；为兼容 W3-DS-01 描述里的 'APPROVAL' 值再追加一项
--
-- 不破坏既有 InvitationServiceImpl 的写入路径（source='INVITATION'）。

ALTER TABLE sys_data_scope
    ADD COLUMN cross_company TINYINT(1) NOT NULL DEFAULT 0 AFTER source,
    ADD COLUMN revoked_at TIMESTAMP NULL DEFAULT NULL AFTER expires_at,
    ADD COLUMN granter_company_id BIGINT NULL DEFAULT NULL AFTER granted_by;

-- 把 source 枚举值扩到包含 APPROVAL（CrossCompanyAuthController#grant 写入 'APPROVAL'）
ALTER TABLE sys_data_scope
    MODIFY COLUMN source ENUM('CROSS_AUTH','INVITATION','APPROVAL') NOT NULL DEFAULT 'CROSS_AUTH';

-- 跨公司专用查询索引：(cross_company, status, expires_at) 用于 24h 提醒 / 0:05 硬过期扫描
CREATE INDEX idx_data_scope_cross_expiry ON sys_data_scope (cross_company, status, expires_at);
