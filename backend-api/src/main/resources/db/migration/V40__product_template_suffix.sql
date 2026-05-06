-- ============================================
-- V40: 给 product 表加 template_suffix 列（Track AS5：跨店推送时透传给 Shopify）
-- Shopify product 字段 template_suffix 决定店铺主题套用哪个 product.<suffix>.liquid
-- 对应 Track AS5 / 店铺资产同步与跨店迁移-评估.md §2.4
-- ============================================

ALTER TABLE product
    ADD COLUMN template_suffix VARCHAR(64) NULL COMMENT 'Shopify product.template_suffix；推送时透传，决定店铺端使用哪个 product.<suffix>.liquid 模板' AFTER status,
    ADD INDEX idx_template_suffix (template_suffix);
