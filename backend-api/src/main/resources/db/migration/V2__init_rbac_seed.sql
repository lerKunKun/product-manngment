-- ============================================
-- V2: RBAC 内置角色 + 权限点种子数据
-- 对应《系统设计文档》8.2 节
-- ============================================

-- 内置角色
INSERT INTO sys_role (code, name, scope, description, builtin) VALUES
  ('PLATFORM_SUPER', '平台超管', 'PLATFORM', '跨租户全部权限，含模板库、租户管理、钉钉企业配置', 1),
  ('COMPANY_ADMIN',  '分公司管理员', 'TENANT', '本公司全部业务，可邀请临时员工到本分公司', 1),
  ('DEPT_LEAD',      '部门主管', 'DEPT', '本部门用户、店铺、产品、审批，可邀请临时员工', 1),
  ('STORE_ADMIN',    '店铺管理员', 'TENANT', 'Token、店铺设置、合作者店铺池接入', 1),
  ('OPERATION',      '运营', 'TENANT', '产品 CRUD、推送、上架状态管理、店铺资产查看', 1),
  ('PURCHASING',     '采购', 'TENANT', '采购页：SKU/成本/克重/物流 tag', 1),
  ('DESIGNER',       '美工', 'TENANT', '产品媒体、需求文档', 1),
  ('READONLY',       '只读', 'TENANT', '全只读', 1),
  ('EMPLOYEE',       '默认员工', 'DEPT', '仅可登录、看本部门基本信息列表', 1),
  ('TEMP_STAFF',     '临时员工', 'DEPT', '邮件邀请的临时员工，权限由邀请时附加角色组合决定，账号 expires_at 强制到期', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

-- 权限点（按模块分组的代表性子集，Wave 1 完整化）
INSERT INTO sys_permission (code, resource, action, name, type) VALUES
  -- 产品
  ('PRODUCT:READ',   'product', 'read',   '查看产品', 'API'),
  ('PRODUCT:WRITE',  'product', 'write',  '编辑产品', 'API'),
  ('PRODUCT:PUSH',   'product', 'push',   '推送产品', 'API'),
  ('PRODUCT:DELETE', 'product', 'delete', '删除产品', 'API'),
  -- 店铺
  ('STORE:READ',         'store', 'read',         '查看店铺', 'API'),
  ('STORE:TOKEN_MANAGE', 'store', 'token_manage', '管理 Shopify Token', 'API'),
  ('STORE:OAUTH',        'store', 'oauth',        '接入店铺 OAuth', 'API'),
  -- 采购
  ('PURCHASE:READ',     'purchase', 'read',     '查看采购信息', 'API'),
  ('PURCHASE:SKU_EDIT', 'purchase', 'sku_edit', '改 SKU（需二次确认）', 'API'),
  -- 媒体
  ('MEDIA:UPLOAD', 'media', 'upload', '上传媒体', 'API'),
  ('MEDIA:DELETE', 'media', 'delete', '删除媒体', 'API'),
  -- 主题
  ('THEME:DEPLOY', 'theme', 'deploy', '部署主题', 'API'),
  ('THEME:PULL',   'theme', 'pull',   '拉取主题快照', 'API'),
  -- 审批
  ('APPROVAL:DECIDE', 'approval', 'decide', '审批决策', 'API'),
  ('APPROVAL:SUBMIT', 'approval', 'submit', '提交审批', 'API'),
  -- 临时员工邀请
  ('TEMP_USER:INVITE', 'temp_user', 'invite', '发起临时员工邀请', 'API'),
  ('TEMP_USER:REVOKE', 'temp_user', 'revoke', '撤销邀请或注销临时账号', 'API'),
  ('TEMP_USER:LIST',   'temp_user', 'list',   '查看临时员工列表', 'API'),
  -- 回收站
  ('RECYCLE_BIN:VIEW',    'recycle', 'view',    '查看回收站', 'API'),
  ('RECYCLE_BIN:RESTORE', 'recycle', 'restore', '恢复软删除项', 'API'),
  -- 平台
  ('PLATFORM:TENANT_MANAGE',    'platform', 'tenant_manage',   '租户管理', 'API'),
  ('PLATFORM:TEMPLATE_MANAGE',  'platform', 'template_manage', '模板库管理', 'API'),
  ('PLATFORM:DINGTALK_CONFIG',  'platform', 'dingtalk_config', '钉钉企业配置', 'API')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- 平台超管：全部权限（占位，实际应在 Wave 1 完整绑定）
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r CROSS JOIN sys_permission p
WHERE r.code = 'PLATFORM_SUPER'
ON DUPLICATE KEY UPDATE role_id = role_id;

-- COMPANY_ADMIN / DEPT_LEAD：临时员工邀请权限
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code IN ('COMPANY_ADMIN', 'DEPT_LEAD')
  AND p.code IN ('TEMP_USER:INVITE', 'TEMP_USER:REVOKE', 'TEMP_USER:LIST')
ON DUPLICATE KEY UPDATE role_id = role_id;
