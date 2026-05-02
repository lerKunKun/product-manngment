-- W3-DS-03：跨公司授权 24h 前提醒一次（dedupe via expiring_notified_at）
ALTER TABLE sys_data_scope
  ADD COLUMN expiring_notified_at TIMESTAMP NULL DEFAULT NULL AFTER revoked_at;
CREATE INDEX idx_data_scope_notify_window ON sys_data_scope (cross_company, status, expires_at, expiring_notified_at);
