-- ============================================
-- V22: W4-NTF-01..04 通知订阅 + 多 corpId 钉钉 + 发送轨迹
--   notification_event_def       事件定义字典
--   notification_subscription    用户订阅
--   notification_log             发送轨迹（含重试退避）
-- ============================================

-- ----- 事件定义字典 -----
CREATE TABLE IF NOT EXISTS notification_event_def (
    code VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(32) NOT NULL,
    default_channels VARCHAR(64) NOT NULL DEFAULT 'DINGTALK,EMAIL',
    default_subscribed TINYINT(1) NOT NULL DEFAULT 1,
    description VARCHAR(512),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='通知事件定义字典';

-- ----- 用户订阅 -----
CREATE TABLE IF NOT EXISTS notification_subscription (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    event_code VARCHAR(64) NOT NULL,
    channels VARCHAR(64) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_event (user_id, event_code),
    KEY idx_event_enabled (event_code, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户通知订阅';

-- ----- 发送轨迹 -----
CREATE TABLE IF NOT EXISTS notification_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT,
    user_id BIGINT NOT NULL,
    event_code VARCHAR(64) NOT NULL,
    channel VARCHAR(16) NOT NULL,
    subject VARCHAR(256),
    body_text TEXT,
    status ENUM('PENDING','SENT','FAILED','SKIPPED') NOT NULL,
    error_msg VARCHAR(1024),
    attempt_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP NULL,
    KEY idx_user_created (user_id, created_at),
    KEY idx_event_status_created (event_code, status, created_at),
    KEY idx_status_retry (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='通知发送轨迹';

-- ----- 事件定义种子数据（与 NotificationEventCode 对齐）-----
INSERT INTO notification_event_def (code, name, category, default_channels, default_subscribed, description) VALUES
  ('INVITATION_SENT',      '邀请已发送',           'INVITATION', 'DINGTALK,EMAIL', 1, '临时员工邀请链接已发出'),
  ('INVITATION_ACCEPTED',  '邀请已接受',           'INVITATION', 'DINGTALK,EMAIL', 1, '受邀人已完成激活'),
  ('TEMP_USER_EXPIRING',   '临时账号即将到期',     'INVITATION', 'DINGTALK,EMAIL', 1, '账号 7 天/3 天/1 天到期前提醒'),
  ('TEMP_USER_EXPIRED',    '临时账号已到期',       'INVITATION', 'DINGTALK,EMAIL', 1, '账号已自动失效'),
  ('STAFF_FROZEN',         '员工已离职/冻结',      'SYSTEM',     'DINGTALK,EMAIL', 1, '钉钉同步检测到员工离职'),
  ('NEW_STORE_SUCCESS',    '新店铺接入成功',       'STORE',      'DINGTALK,EMAIL', 1, 'Saga 流程完成'),
  ('NEW_STORE_FAIL',       '新店铺接入失败',       'STORE',      'DINGTALK,EMAIL', 1, 'Saga 流程异常'),
  ('PRODUCT_PUSH_FAIL',    '产品推送失败',         'PUSH',       'DINGTALK,EMAIL', 1, '上下架/同步失败'),
  ('THEME_PUSH_SUCCESS',   '主题推送成功',         'PUSH',       'DINGTALK,EMAIL', 0, '主题部署完成（默认关闭，避免噪音）'),
  ('THEME_PUSH_FAIL',      '主题推送失败',         'PUSH',       'DINGTALK,EMAIL', 1, '主题部署异常'),
  ('TOKEN_EXPIRING',       '店铺 Token 即将到期',  'STORE',      'DINGTALK,EMAIL', 1, 'Shopify access token 30 天前提醒'),
  ('BACKUP_FAIL',          '备份任务失败',         'OPS',        'DINGTALK,EMAIL', 1, '夜间备份未完成'),
  ('APPROVAL_PENDING',     '有待办审批',           'APPROVAL',   'DINGTALK,EMAIL', 1, '审批节点指向您'),
  ('APPROVAL_DECIDED',     '审批已决策',           'APPROVAL',   'DINGTALK,EMAIL', 1, '我的审批被通过/驳回'),
  ('CROSS_AUTH_EXPIRING',  '跨公司授权即将到期',   'APPROVAL',   'DINGTALK,EMAIL', 1, '24 小时内到期提醒'),
  ('HIGH_RISK_OP',         '高危操作通知',         'OPS',        'DINGTALK,EMAIL', 1, 'SUPER_ADMIN 兜底告警')
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category),
  default_channels = VALUES(default_channels), default_subscribed = VALUES(default_subscribed),
  description = VALUES(description);

-- ----- 多 corpId 钉钉表（已在 V1 创建：dingtalk_corp）-----
-- W4-NTF-03 用 dingtalk_corp.app_key / encrypted_app_secret / agent_id；
-- 当前留空表，后续企业接入时由管理后台 INSERT。
