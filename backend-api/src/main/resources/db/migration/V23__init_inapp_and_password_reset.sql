-- ============================================
-- V23: W4-MAIL-01..03 站内信 + 密码重置 token
-- inapp_message       : 站内信通道（NotificationSendService.dispatch INAPP 分支落地）
-- password_reset_token: 忘记密码流程；token 存 SHA-256，原文只在邮件链接中出现一次
-- 按本仓库约定不建外键约束（FK），仅以索引体现关联
-- ============================================

CREATE TABLE IF NOT EXISTS inapp_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NULL COMMENT '租户 ID（跨租户系统消息为 NULL）',
    user_id BIGINT NOT NULL COMMENT '收件人 sys_user.id',
    event_code VARCHAR(64) NOT NULL COMMENT '与 NotificationEventCode 对齐',
    subject VARCHAR(256) NOT NULL COMMENT '标题（列表展示）',
    body_html TEXT NULL COMMENT '正文 HTML（详情展开）',
    body_text TEXT NULL COMMENT '正文纯文本（IM/钉钉降级时用）',
    link_url VARCHAR(512) NULL COMMENT '点击跳转链接（可选）',
    read_at TIMESTAMP NULL COMMENT '阅读时间，NULL = 未读',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inapp_user_read_created (user_id, read_at, created_at),
    INDEX idx_inapp_event_created (event_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内信收件箱（W4-MAIL-02）';

CREATE TABLE IF NOT EXISTS password_reset_token (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL COMMENT '关联 sys_user.id（无外键）',
    token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 of raw token（原文只在邮件链接中出现一次）',
    email VARCHAR(255) NOT NULL COMMENT '申请时的邮箱（防止用户中途改邮箱后旧 token 仍可用）',
    expires_at TIMESTAMP NOT NULL COMMENT '过期时间，签发后 30min',
    used_at TIMESTAMP NULL COMMENT '使用时间，NULL = 未使用',
    requested_ip VARCHAR(64) NULL COMMENT '申请方 IP，审计用',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_password_reset_token_hash (token_hash),
    INDEX idx_password_reset_user_created (user_id, created_at),
    INDEX idx_password_reset_expires_used (expires_at, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='忘记密码 reset token（W4-MAIL-03）';
