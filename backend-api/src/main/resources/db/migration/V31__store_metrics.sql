-- ============================================
-- V31: 店铺管理卡片视图所需的指标字段
-- shopify_plan：调 shop.json plan_name 写入（接入时 + 每日刷新）
-- gmv_30d / order_count_30d / metrics_currency：调 orders.json 30d 聚合
-- metrics_fetched_at：上次成功刷新时间，前端可据此显示「数据于 X 时刷新」
-- ============================================

ALTER TABLE store
  ADD COLUMN shopify_plan VARCHAR(64) NULL COMMENT 'Shopify 套餐名（plan_name），如 enterprise / shopify_plus / partner_test / professional / basic',
  ADD COLUMN gmv_30d DECIMAL(15,2) NULL COMMENT '近 30 天 paid 订单 GMV（按 metrics_currency）',
  ADD COLUMN order_count_30d INT NULL COMMENT '近 30 天 paid 订单数',
  ADD COLUMN metrics_currency CHAR(3) NULL COMMENT '订单本币 ISO 4217（取首单 currency 字段）',
  ADD COLUMN metrics_fetched_at TIMESTAMP NULL COMMENT '上次成功刷新指标的时间';
