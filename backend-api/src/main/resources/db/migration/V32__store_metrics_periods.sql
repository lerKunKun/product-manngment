-- ============================================
-- V32: store 加 metrics_periods JSON 列，存 5 个时间窗的 GMV / 订单数
-- 结构：{
--   "today":  {"gmv": 1234.56, "orders": 12},
--   "week":   {"gmv": 9876.54, "orders": 87},
--   "month":  {...},
--   "year":   {...},
--   "ytd":    {...},
--   "currency": "USD"
-- }
-- 时间桶定义（rolling 而非 calendar）：
--   today = SINCE today 00:00 UTC
--   week  = SINCE -7d
--   month = SINCE -30d
--   year  = SINCE -365d
--   ytd   = SINCE current_year-01-01
--
-- V31 加的 gmv_30d / order_count_30d 等列保留（兼容历史；新代码用 metrics_periods）
-- ============================================

ALTER TABLE store
  ADD COLUMN metrics_periods JSON NULL COMMENT '5 个时间窗 GMV/订单数聚合（today/week/month/year/ytd + currency）';
