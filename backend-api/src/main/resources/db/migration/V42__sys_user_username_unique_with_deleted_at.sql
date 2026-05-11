-- ============================================
-- V42: sys_user.username UNIQUE 改成复合 (username, deleted_at)
--
-- 背景：SysUser 有 @TableLogic（deleted_at），MyBatis-Plus 自动给所有查询
-- 加 `WHERE deleted_at IS NULL`，但原来的物理 UNIQUE KEY (username) 不考虑
-- 软删除——已 soft-delete 的旧行长期占着 username 命名空间，让"删了账号
-- 之后再次邀请同邮箱"在 insert 阶段撞 UNIQUE 冲突，抛 DuplicateKeyException
-- 并触发事务回滚，invitation 又退回 PENDING 可被无限重放。
--
-- MySQL 的 UNIQUE 对 NULL 处理：(a, NULL) 不与 (a, NULL) 冲突——所以同名
-- + deleted_at=NULL 只能存 1 行（=当前 active 的那行），同时与若干已删除的
-- (a, '<具体时间戳>') 行共存。这正是想要的：active 命名空间还是唯一，但
-- 已删除的行不再占名。
--
-- employee_no UNIQUE 暂不动——TEMP 的 employee_no 来自 invitation.id 自增，
-- 不存在重放冲突；STAFF 的可能由 HR 手工分配，复合改动可能影响业务约定。
-- 如果将来 STAFF 也走 soft-delete + 重建，再统一处理。
-- ============================================

ALTER TABLE sys_user DROP INDEX `username`;
ALTER TABLE sys_user ADD UNIQUE KEY `uk_user_username_alive` (`username`, `deleted_at`);
