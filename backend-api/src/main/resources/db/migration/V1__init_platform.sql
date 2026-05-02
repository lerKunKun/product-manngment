-- ============================================
-- V1: 平台主库基础表
-- 对应《系统设计文档》6.2 节
-- 作用域：platform 库（不含 tenant_xx 业务表）
-- ============================================

SET NAMES utf8mb4;
SET TIME_ZONE = '+00:00';

-- ===== 用户 =====
CREATE TABLE IF NOT EXISTS sys_user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    employee_no VARCHAR(32) NOT NULL UNIQUE COMMENT 'jobNumber 优先；为空则 EMP000001 自增；TEMP 用 TMP000001',
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(128),
    password_must_change TINYINT(1) NOT NULL DEFAULT 0,
    email VARCHAR(128),
    phone VARCHAR(32),
    dingtalk_unionid VARCHAR(64),
    dingtalk_userid VARCHAR(64),
    dingtalk_corp_id VARCHAR(64),
    default_tenant_id BIGINT,
    user_type ENUM('STAFF','TEMP') NOT NULL DEFAULT 'STAFF' COMMENT 'STAFF=钉钉来源；TEMP=邮件邀请',
    expires_at TIMESTAMP NULL COMMENT '仅 TEMP：账号到期时间（必填，最长 90 天）',
    status ENUM('ACTIVE','FROZEN','DELETED','EXPIRED') NOT NULL DEFAULT 'ACTIVE' COMMENT 'FROZEN=离职冷冻30天；EXPIRED=临时账号到期',
    frozen_at TIMESTAMP NULL,
    expired_at TIMESTAMP NULL,
    invited_by BIGINT NULL COMMENT '仅 TEMP：邀请人',
    invitation_id BIGINT NULL COMMENT '仅 TEMP：关联 user_invitation.id',
    last_login_at TIMESTAMP NULL,
    last_login_ip VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    INDEX idx_unionid_corp (dingtalk_unionid, dingtalk_corp_id),
    INDEX idx_user_type_status (user_type, status),
    INDEX idx_expires_at (expires_at),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户主表';

-- ===== 组织 =====
CREATE TABLE IF NOT EXISTS sys_org (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    parent_id BIGINT NULL,
    type ENUM('COMPANY','DEPT') NOT NULL,
    name VARCHAR(128) NOT NULL,
    code VARCHAR(64) NOT NULL UNIQUE COMMENT 'COMPANY 节点：分公司简称（如 hy/bj）',
    tenant_id BIGINT NULL COMMENT 'COMPANY 节点对应 tenant_xx；DEPT 继承父',
    path VARCHAR(512) NOT NULL DEFAULT '/' COMMENT '物化路径 /1/3/12/',
    dingtalk_dept_id VARCHAR(64),
    dingtalk_corp_id VARCHAR(64),
    sort INT NOT NULL DEFAULT 0,
    status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    INDEX idx_parent (parent_id),
    INDEX idx_path (path),
    INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='组织树（COMPANY/DEPT 共表）';

-- ===== RBAC =====
CREATE TABLE IF NOT EXISTS sys_role (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    scope ENUM('PLATFORM','TENANT','DEPT') NOT NULL,
    description VARCHAR(255),
    builtin TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色';

CREATE TABLE IF NOT EXISTS sys_permission (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(128) NOT NULL UNIQUE COMMENT '如 PRODUCT:READ',
    resource VARCHAR(64),
    action VARCHAR(64),
    name VARCHAR(128),
    parent_id BIGINT NULL,
    type ENUM('MENU','BUTTON','API') NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='权限点';

CREATE TABLE IF NOT EXISTS sys_role_permission (
    role_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-权限';

CREATE TABLE IF NOT EXISTS sys_user_role (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    org_id BIGINT NULL COMMENT '角色绑定到具体组织节点',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_role_org (user_id, role_id, org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户-角色';

-- ===== 数据范围（跨公司 + 邀请来源） =====
CREATE TABLE IF NOT EXISTS sys_data_scope (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    scope_type ENUM('STORE','COMPANY','PRODUCT') NOT NULL,
    scope_id BIGINT NOT NULL,
    access ENUM('READ','WRITE') NOT NULL,
    granted_by BIGINT NOT NULL,
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    approval_id BIGINT NULL,
    source ENUM('CROSS_AUTH','INVITATION') NOT NULL DEFAULT 'CROSS_AUTH',
    status ENUM('ACTIVE','EXPIRING','EXPIRED','REVOKED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_status (user_id, status),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='显式数据授权';

-- ===== 临时员工邀请 =====
CREATE TABLE IF NOT EXISTS user_invitation (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(128) NOT NULL,
    target_company_id BIGINT NOT NULL,
    target_dept_id BIGINT NULL,
    role_codes JSON NOT NULL COMMENT '邀请时分配的角色 code 列表',
    data_scopes JSON NOT NULL COMMENT '邀请时分配的数据范围',
    account_expires_at TIMESTAMP NOT NULL COMMENT '临时账号到期时间（必填，最长 90 天）',
    invitation_token VARCHAR(64) NOT NULL UNIQUE,
    link_expires_at TIMESTAMP NOT NULL COMMENT '邀请链接 48h 有效',
    initial_password_hash VARCHAR(128) NOT NULL,
    status ENUM('PENDING','ACCEPTED','LINK_EXPIRED','REVOKED') NOT NULL DEFAULT 'PENDING',
    invited_by BIGINT NOT NULL,
    invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP NULL,
    created_user_id BIGINT NULL,
    revoked_by BIGINT NULL,
    revoked_at TIMESTAMP NULL,
    revoke_reason VARCHAR(255),
    INDEX idx_email_status (email, status),
    INDEX idx_token (invitation_token),
    INDEX idx_account_expires (account_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='临时员工邮件邀请';

-- ===== 租户路由 =====
CREATE TABLE IF NOT EXISTS sys_tenant (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    datasource_key VARCHAR(64) NOT NULL,
    status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='租户';

CREATE TABLE IF NOT EXISTS sys_tenant_datasource (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    jdbc_url VARCHAR(512) NOT NULL,
    username VARCHAR(64) NOT NULL,
    encrypted_password VARCHAR(512) NOT NULL,
    pool_min INT NOT NULL DEFAULT 2,
    pool_max INT NOT NULL DEFAULT 20,
    status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='租户数据源';

-- ===== 钉钉企业（多 corpId） =====
CREATE TABLE IF NOT EXISTS dingtalk_corp (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    corp_id VARCHAR(64) NOT NULL UNIQUE,
    corp_name VARCHAR(128) NOT NULL,
    is_main TINYINT(1) NOT NULL DEFAULT 0,
    agent_id VARCHAR(64),
    app_key VARCHAR(64),
    encrypted_app_secret VARCHAR(512),
    access_token VARCHAR(512),
    access_token_expires_at TIMESTAMP NULL,
    bound_company_org_id BIGINT NULL,
    whitelist_corp_ids JSON,
    status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='钉钉企业配置';

-- ===== 钉钉同步日志 =====
CREATE TABLE IF NOT EXISTS sys_org_dingtalk_sync_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sync_type ENUM('FULL','EVENT') NOT NULL,
    trigger_event VARCHAR(64),
    affected_users INT NOT NULL DEFAULT 0,
    affected_depts INT NOT NULL DEFAULT 0,
    status ENUM('RUNNING','SUCCESS','FAILED') NOT NULL,
    error_msg TEXT,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    INDEX idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='钉钉同步日志';

-- ===== 审计日志（按月分区在 Wave 4 加） =====
CREATE TABLE IF NOT EXISTS sys_audit_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT,
    username VARCHAR(64),
    employee_no VARCHAR(32),
    org_id BIGINT,
    tenant_id BIGINT,
    module VARCHAR(64),
    action VARCHAR(64),
    resource_type VARCHAR(64),
    resource_id VARCHAR(128),
    request_method VARCHAR(16),
    request_uri VARCHAR(512),
    request_payload JSON,
    response_status INT,
    ip VARCHAR(64),
    user_agent VARCHAR(512),
    `sensitive` TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_module_created (module, created_at),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审计日志';
