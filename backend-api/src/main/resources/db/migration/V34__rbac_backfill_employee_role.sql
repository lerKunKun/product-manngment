-- ============================================
-- V34: 给所有"无角色"的 sys_user 兜底分 EMPLOYEE 角色
--
-- 背景：DingTalkLoginService 是中后期才加的默认 EMPLOYEE 分配；早期注册的钉钉
-- 用户、SQL 脚本造的 admin 用户、AuthServiceImpl 用户名密码登录创建路径等都
-- 可能 sys_user_role 0 行。一旦 @PreAuthorize 上线这些用户全部 403 登进来无路可走。
--
-- 策略：所有 sys_user.status='ACTIVE' 且 sys_user_role 无任何行的用户 → 插一行
-- EMPLOYEE 兜底。已有任意角色（包括 admin 类）的用户不动。INSERT IGNORE 幂等。
-- 注意：admin 用户的 PLATFORM_SUPER 角色需要单独 SQL 维护（不在本 migration 范围）。
-- ============================================

INSERT IGNORE INTO sys_user_role (user_id, role_id, org_id)
SELECT u.id,
       (SELECT id FROM sys_role WHERE code = 'EMPLOYEE' LIMIT 1) AS role_id,
       NULL
FROM sys_user u
LEFT JOIN sys_user_role ur ON ur.user_id = u.id
WHERE u.deleted_at IS NULL
  AND u.status = 'ACTIVE'
  AND ur.id IS NULL;
