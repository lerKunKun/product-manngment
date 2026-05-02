-- ============================================
-- V3: 开发环境种子数据（仅 dev profile 用，生产不应执行）
-- 作用：为联调临时员工邀请提供最小可用数据：
--   - 1 个分公司：HY（汉阳）+ 1 个部门：DESIGN
--   - 1 个管理员（admin / 密码 admin123）—— 即邀请人
--   - 1 个 tenant_id 占位
-- 上线前请用 V_PRODUCTION_*__cleanup.sql 删除
-- ============================================

-- 租户占位
INSERT INTO sys_tenant (id, code, name, datasource_key, status) VALUES
  (1, 'hy', '汉阳分公司', 'tenant_01', 'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- 组织：分公司 + 部门
INSERT INTO sys_org (id, parent_id, type, name, code, tenant_id, path, sort, status) VALUES
  (1, NULL, 'COMPANY', '汉阳分公司', 'hy', 1, '/1/', 1, 'ACTIVE'),
  (2, 1, 'DEPT', '设计部', 'hy_design', 1, '/1/2/', 1, 'ACTIVE')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- 管理员账号：username=admin / password=admin123（BCrypt cost 12）
-- BCrypt hash 来自：BCrypt.hashpw("admin123", BCrypt.gensalt(12))
INSERT INTO sys_user (
  id, employee_no, username, password_hash, password_must_change,
  email, user_type, status, default_tenant_id, created_at, updated_at
) VALUES (
  1, 'EMP000001', 'admin',
  '$2b$12$0P8qp12yx8c51tD.gn9mHegGdbGccahMmyudzah5SBaLGK839fDRO',
  0,
  'admin@biounetwork.com', 'STAFF', 'ACTIVE', 1, NOW(), NOW()
)
ON DUPLICATE KEY UPDATE username = VALUES(username);

-- 把 admin 绑成 COMPANY_ADMIN
INSERT INTO sys_user_role (user_id, role_id, org_id, created_at)
SELECT 1, r.id, 1, NOW() FROM sys_role r WHERE r.code = 'COMPANY_ADMIN'
ON DUPLICATE KEY UPDATE role_id = role_id;
