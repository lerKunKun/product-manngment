-- V41: 清理钉钉自助注册产生的、用户从未自己改过的临时密码。
--
-- 背景：W1-AUTH-05 的 TODO（钉钉工作通知发临时密码）从未实现，
-- 钉钉首登用户的 password_hash 是用户拿不到的随机值，
-- 个人中心又要求填"原密码"才能改 → 死锁。
--
-- 重新定义 password_hash 三态：
--   NULL          → 未设过本地密码（钉钉用户首登态）
--   非 NULL + must_change=1 → 临时密码态（管理员手发 / 邀请激活）
--   非 NULL + must_change=0 → 正常本地密码
--
-- 配套代码改动：
--   - DingTalkLoginService.autoRegister 不再生成 tempPwd
--   - UserProfileController.changePassword 在 hash IS NULL 时跳过 oldPassword 校验
--   - 前端 profile 页根据 hasPassword 切「设置」/「修改」分支
--
-- 边界说明：
--   - dingtalk_unionid IS NOT NULL：仅作用于已绑钉钉的账号，纯账密用户/管理员账号不动
--   - password_must_change = 1：已自己改过密码的用户不动（must_change 早被置 0）
--   - 极端情况：管理员给已绑钉钉用户手动重置过密码且仍 must_change=1 的会被一并清空，
--     钉钉登录不受影响，用户在 profile 看到「设置本地密码」即可。

UPDATE sys_user
SET password_hash = NULL,
    password_must_change = 0
WHERE dingtalk_unionid IS NOT NULL
  AND password_must_change = 1
  AND deleted_at IS NULL;
