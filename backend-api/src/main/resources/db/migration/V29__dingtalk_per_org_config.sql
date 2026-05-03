-- ============================================================
-- V29: 钉钉子系统按组织化（per-COMPANY 一对一）+ 同步执行日志
-- ============================================================
-- 背景：原 dingtalk.* 配置写死在 application.yml / env，
-- 多组织无法并存多套 App 配置；本次将配置提到 sys_org_dingtalk_config
-- 表，env 仅作为兜底 fallback。AppSecret 使用 AES-GCM 入库。
-- ============================================================

CREATE TABLE sys_org_dingtalk_config (
  org_id          BIGINT       PRIMARY KEY                   COMMENT '组织 sys_org.id（COMPANY 节点）',
  corp_id         VARCHAR(64)  NOT NULL                      COMMENT '钉钉企业 corpId',
  app_key         VARCHAR(64)  NOT NULL                      COMMENT '钉钉企业内部应用 AppKey',
  app_secret_enc  VARCHAR(1024) NOT NULL                     COMMENT 'AppSecret 经 AES-GCM 加密（base64）',
  agent_id        VARCHAR(32)  NOT NULL                      COMMENT '应用 AgentId',
  event_token     VARCHAR(64)  NULL                          COMMENT '事件订阅签名 token（可选）',
  event_aes_key   VARCHAR(64)  NULL                          COMMENT '事件订阅 AES key（可选）',
  status          ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '配置状态',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='组织级钉钉应用配置（per-COMPANY 一对一）';

CREATE TABLE dingtalk_sync_log (
  id              BIGINT       PRIMARY KEY AUTO_INCREMENT     COMMENT '主键',
  org_id          BIGINT       NOT NULL                       COMMENT '组织 sys_org.id（COMPANY 节点）',
  scope           ENUM('DEPT','USER','ALL') NOT NULL          COMMENT '同步范围：部门 / 用户 / 全量',
  trigger_source  ENUM('CREATE_ORG','MANUAL','SCHEDULED') NOT NULL COMMENT '触发来源：建组织 / 手动 / 调度',
  added           INT          NOT NULL DEFAULT 0             COMMENT '新增条数',
  skipped         INT          NOT NULL DEFAULT 0             COMMENT '跳过条数（unionId 已存在等）',
  failed          INT          NOT NULL DEFAULT 0             COMMENT '失败条数',
  error_msg       VARCHAR(2048) NULL                          COMMENT '错误摘要（最近一次）',
  started_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
  finished_at     TIMESTAMP    NULL                           COMMENT '结束时间',
  INDEX idx_org_started (org_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='钉钉同步执行日志';
