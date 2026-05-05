-- ============================================
-- V33: RBAC 角色 × 权限矩阵补齐 + 缺失权限码
--
-- 背景：V2 只对 PLATFORM_SUPER（cross-join 全配）+ COMPANY_ADMIN/DEPT_LEAD（仅
-- TEMP_USER:*）做了映射，其余 7 个内置角色 0 perm。一旦后端 @PreAuthorize / hasAuthority
-- 上线，这些角色用户全部 403。本 migration 按业务语义补齐 + 引入新权限码以支持
-- USER / ROLE / ORG / AUDIT / OPS / NOTIFICATION / DATASCOPE 模块的细粒度授权。
--
-- 全部 INSERT IGNORE / ON DUPLICATE KEY，幂等可重跑。
-- ============================================

-- ===== 1. 新增权限码 =====
INSERT INTO sys_permission (code, resource, action, name, type) VALUES
  ('USER:READ',          'user',         'read',   '查看用户列表 / 详情',          'API'),
  ('USER:MANAGE',        'user',         'manage', '管理用户（创建/冻结/改角色/重置密码）', 'API'),
  ('ROLE:READ',          'role',         'read',   '查看角色 / 权限',              'API'),
  ('ROLE:MANAGE',        'role',         'manage', '管理角色 / 重置权限',          'API'),
  ('ORG:READ',           'org',          'read',   '查看组织树',                   'API'),
  ('ORG:MANAGE',         'org',          'manage', '管理组织 / 同步钉钉',          'API'),
  ('NOTIFICATION:MANAGE','notification', 'manage', '订阅 / 通知模板管理',          'API'),
  ('AUDIT:READ',         'audit',        'read',   '查看审计日志',                 'API'),
  ('OPS:READ',           'ops',          'read',   '运维监控查看',                 'API'),
  ('OPS:MANAGE',         'ops',          'manage', '运维操作（备份/归档/DR）',     'API'),
  ('DATASCOPE:GRANT',    'datascope',    'grant',  '跨公司 / 跨部门数据授权',      'API')
ON DUPLICATE KEY UPDATE name = VALUES(name), resource = VALUES(resource), action = VALUES(action);

-- ===== 2. PLATFORM_SUPER 重新 cross-join（吸收新增权限码）=====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r CROSS JOIN sys_permission p
WHERE r.code = 'PLATFORM_SUPER'
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 3. COMPANY_ADMIN：本公司全业务 + 用户/审计可见 + 可批授权 =====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'COMPANY_ADMIN'
  AND p.code IN (
    'PRODUCT:READ','PRODUCT:WRITE','PRODUCT:PUSH','PRODUCT:DELETE',
    'STORE:READ','STORE:TOKEN_MANAGE','STORE:OAUTH',
    'PURCHASE:READ','PURCHASE:SKU_EDIT',
    'MEDIA:UPLOAD','MEDIA:DELETE',
    'THEME:DEPLOY','THEME:PULL',
    'APPROVAL:DECIDE','APPROVAL:SUBMIT',
    'RECYCLE_BIN:VIEW','RECYCLE_BIN:RESTORE',
    'USER:READ','USER:MANAGE',
    'ROLE:READ',
    'ORG:READ',
    'NOTIFICATION:MANAGE',
    'AUDIT:READ',
    'DATASCOPE:GRANT'
    -- TEMP_USER:* 已在 V2 配过；此处不重复（ON DUPLICATE KEY 兜底）
  )
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 4. DEPT_LEAD：本部门业务 + 邀请临时员工，无删 / 无 token / 无授权 =====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'DEPT_LEAD'
  AND p.code IN (
    'PRODUCT:READ','PRODUCT:WRITE','PRODUCT:PUSH',
    'STORE:READ',
    'PURCHASE:READ',
    'MEDIA:UPLOAD','MEDIA:DELETE',
    'THEME:PULL',
    'APPROVAL:DECIDE','APPROVAL:SUBMIT',
    'RECYCLE_BIN:VIEW',
    'USER:READ',
    'ROLE:READ',
    'ORG:READ'
  )
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 5. STORE_ADMIN：店铺接入 / token / 主题部署 =====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'STORE_ADMIN'
  AND p.code IN (
    'STORE:READ','STORE:TOKEN_MANAGE','STORE:OAUTH',
    'PRODUCT:READ',
    'MEDIA:UPLOAD','MEDIA:DELETE',
    'THEME:DEPLOY','THEME:PULL'
  )
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 6. OPERATION：产品 CRUD + 推送，无删，可提审批 =====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'OPERATION'
  AND p.code IN (
    'PRODUCT:READ','PRODUCT:WRITE','PRODUCT:PUSH',
    'STORE:READ',
    'MEDIA:UPLOAD',
    'APPROVAL:SUBMIT',
    'THEME:PULL'
  )
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 7. PURCHASING：采购页 SKU/成本，附带产品只读 =====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'PURCHASING'
  AND p.code IN (
    'PURCHASE:READ','PURCHASE:SKU_EDIT',
    'PRODUCT:READ'
  )
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 8. DESIGNER：媒体 + 产品只读 =====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'DESIGNER'
  AND p.code IN (
    'MEDIA:UPLOAD','MEDIA:DELETE',
    'PRODUCT:READ'
  )
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 9. READONLY：全只读 =====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'READONLY'
  AND p.code IN (
    'PRODUCT:READ',
    'STORE:READ',
    'PURCHASE:READ'
  )
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 10. EMPLOYEE：默认登录账号最低权限 =====
-- 自助注册 / 兜底分配的用户拿到这个角色；没这两条会出现"登进来导航全空 + 接口全 403"。
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'EMPLOYEE'
  AND p.code IN (
    'PRODUCT:READ',
    'STORE:READ'
  )
ON DUPLICATE KEY UPDATE role_id = role_id;

-- ===== 11. TEMP_STAFF：与 EMPLOYEE 等同；具体扩权由 sys_data_scope（source=INVITATION）行决定 =====
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'TEMP_STAFF'
  AND p.code IN (
    'PRODUCT:READ',
    'STORE:READ'
  )
ON DUPLICATE KEY UPDATE role_id = role_id;
