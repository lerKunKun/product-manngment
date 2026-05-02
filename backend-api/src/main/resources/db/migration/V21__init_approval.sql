-- ============================================
-- V21: W4-APP-01 审批中心 (approval_flow + approval_log)
-- 对应《系统设计文档》8.10 / Wave 4 G1 track。
-- 设计要点：
--   - approval_flow.payload 用 JSON 存申请上下文（productId/scopeType/scopeId/expiresAt/reason 等），
--     具体 schema 由 type 决定，由 ApprovalEngine.hooks 解释。
--   - PENDING 时可以指向具体 current_approver_id，或仅指定 current_approver_role（任一角色签批）。
--   - REJECTED 可走 resubmit 重置回 PENDING；CANCELLED 由申请人撤回。
-- ============================================

CREATE TABLE IF NOT EXISTS approval_flow (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NULL COMMENT '申请发起公司 tenant_id；为空表平台级',
    `type` VARCHAR(64) NOT NULL COMMENT 'PRODUCT_ACCESS / CROSS_COMPANY_AUTH / ...',
    applicant_id BIGINT NOT NULL COMMENT '申请人 sys_user.id',
    target_user_id BIGINT NULL COMMENT '受益人；跨公司授权时 != applicant',
    payload JSON NOT NULL COMMENT '申请上下文：productId/scopeType/scopeId/expiresAt/reason 等',
    status ENUM('PENDING','APPROVED','REJECTED','CANCELLED','RESUBMITTED') NOT NULL DEFAULT 'PENDING',
    current_approver_id BIGINT NULL COMMENT 'PENDING 时指向某具体审批人；NULL 表示按角色任一',
    current_approver_role VARCHAR(64) NULL COMMENT '任一角色签批模式时指定角色 code',
    decided_by BIGINT NULL COMMENT '最终决策人 sys_user.id',
    decided_at TIMESTAMP NULL,
    decision_comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tenant_status_created (tenant_id, status, created_at),
    INDEX idx_applicant_created (applicant_id, created_at),
    INDEX idx_approver_status (current_approver_id, status),
    INDEX idx_type_status_created (`type`, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审批流主表';

CREATE TABLE IF NOT EXISTS approval_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    flow_id BIGINT NOT NULL,
    actor_id BIGINT NOT NULL COMMENT '操作人 sys_user.id',
    action ENUM('SUBMIT','APPROVE','REJECT','RESUBMIT','CANCEL') NOT NULL,
    `comment` TEXT,
    payload_snapshot JSON NULL COMMENT '重提时存当时 payload，便于追溯',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_flow_created (flow_id, created_at),
    INDEX idx_actor_created (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审批轨迹';
