-- ============================================
-- V39: 店铺与基础模板版本的绑定表（Track AS5：跨店推送占位符替换）
-- 一店一绑定（uk_store），custom_replace_rules_json 与 base_template_version.default_replace_rules_json 合并使用。
-- 对应 Track AS5 / 店铺资产同步与跨店迁移-评估.md §3
-- 注：按本仓库约定不建外键约束（FK），仅以索引体现关联
-- ============================================

CREATE TABLE store_template_binding (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    store_id BIGINT NOT NULL COMMENT '关联 store.id（无外键）',
    base_template_version_id BIGINT NOT NULL COMMENT '关联 base_template_version.id（无外键）',
    custom_replace_rules_json TEXT NULL COMMENT '该店铺自定义替换规则 JSON：覆盖/扩展模板默认规则',
    bound_at DATETIME NOT NULL COMMENT '绑定时间',
    bound_by BIGINT NULL COMMENT '操作者 sys_user.id',
    UNIQUE KEY uk_store (store_id),
    INDEX idx_template_version (base_template_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='店铺-模板版本绑定表';
