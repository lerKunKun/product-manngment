-- ============================================
-- V7: product_doc.rich_text_json 改为 LONGTEXT
-- 因前端 TipTap 输出为 HTML 字符串而非合法 JSON，
-- 用 JSON 列会触发 DataIntegrityViolation。改用 LONGTEXT 更通用。
-- ============================================

ALTER TABLE product_doc MODIFY COLUMN rich_text_json LONGTEXT NULL
    COMMENT 'TipTap 输出 HTML（字段名沿用 rich_text_json 历史，类型为 LONGTEXT）';
