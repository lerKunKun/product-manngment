-- ============================================
-- V15: 平台主题模板库 + 指导文档表骨架
-- base_template / base_template_version：平台维护的可复用主题模板，每个模板挂多个版本（R2 zip + 默认替换规则）
-- guide_doc：一键开店向导各步骤的指引文档（菜单 / Markets / Policy 等），TipTap HTML 与 product_doc 一致
-- 对应 W3-TPL-01 / W3-GUIDE-01
-- 注：按本仓库约定不建外键约束（FK），仅以索引体现关联
-- ============================================

CREATE TABLE IF NOT EXISTS base_template (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) NOT NULL COMMENT '模板唯一编码，如 health-supplement-v1',
    name VARCHAR(128) NOT NULL COMMENT '模板展示名（中英文）',
    description TEXT NULL COMMENT '模板描述',
    category VARCHAR(64) NULL COMMENT '分类：health / beauty / general 等',
    cover_image_r2_key VARCHAR(512) NULL COMMENT '模板预览图在 R2 的 key（可空，frontend 加占位）',
    default_template_version_id BIGINT NULL COMMENT '指向 base_template_version.id；新建时空，发布版本后填（无外键）',
    status ENUM('DRAFT', 'PUBLISHED', 'DEPRECATED') NOT NULL DEFAULT 'DRAFT' COMMENT '模板状态',
    created_by BIGINT NULL COMMENT '创建者 sys_user.id',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uk_base_template_code (code),
    INDEX idx_template_status (status, category, created_at),
    INDEX idx_template_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台主题模板主表';

CREATE TABLE IF NOT EXISTS base_template_version (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id BIGINT NOT NULL COMMENT '关联 base_template.id（无外键）',
    version VARCHAR(32) NOT NULL COMMENT 'semver-ish 版本号：1.0.0 / 1.1.0-beta',
    zip_r2_key VARCHAR(512) NOT NULL COMMENT '主题 zip 在 R2 的 key',
    zip_bytes BIGINT NULL COMMENT 'zip 文件字节数（展示用）',
    zip_sha256 CHAR(64) NULL COMMENT 'zip 文件 SHA256，用于完整性校验',
    default_replace_rules_json TEXT NULL COMMENT '默认替换规则 JSON：{"shop_name":{"from":"BIOU","to":"{{brand}}"}, "domain":{"from":"biou.com","to":"{{custom_domain}}"}}',
    changelog TEXT NULL COMMENT '版本变更日志 markdown',
    status ENUM('DRAFT', 'PUBLISHED', 'DEPRECATED') NOT NULL DEFAULT 'DRAFT' COMMENT '版本状态',
    created_by BIGINT NULL COMMENT '创建者 sys_user.id',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uk_template_version (template_id, version),
    INDEX idx_template_version_status (template_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台主题模板版本表';

CREATE TABLE IF NOT EXISTS guide_doc (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) NOT NULL COMMENT '指引唯一编码，如 menu_setup_after_newstore / policy_legal_template',
    title VARCHAR(255) NOT NULL COMMENT '指引标题',
    category VARCHAR(64) NULL COMMENT '分类：menu / policy / markets / general 等',
    body_html LONGTEXT NULL COMMENT 'TipTap 输出 HTML（与 product_doc 一致，非 JSON）',
    body_markdown LONGTEXT NULL COMMENT '可选 markdown 源',
    related_template_id BIGINT NULL COMMENT '关联 base_template.id（NULL = 通用指引，无外键）',
    show_in_saga_step VARCHAR(64) NULL COMMENT '一键开店 saga 步骤标识：GUIDE 等；NULL = 不绑定 saga',
    status ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT' COMMENT '指引状态',
    created_by BIGINT NULL COMMENT '创建者 sys_user.id',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    UNIQUE KEY uk_guide_doc_code (code),
    INDEX idx_guide_category (category, status),
    INDEX idx_guide_template (related_template_id),
    INDEX idx_guide_saga_step (show_in_saga_step)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='一键开店向导指引文档表';
