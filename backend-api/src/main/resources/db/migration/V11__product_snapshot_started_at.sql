-- W2-SNAP-04 起改：补 started_at 字段，让 RUNNING 阶段可追踪
ALTER TABLE product_snapshot
  ADD COLUMN started_at TIMESTAMP NULL DEFAULT NULL AFTER created_at;
