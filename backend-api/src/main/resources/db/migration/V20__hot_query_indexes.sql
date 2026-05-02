-- ============================================
-- V20: W3-PERF-02 热点查询索引补全
-- 来源：grep 仓库 LambdaQueryWrapper / QueryWrapper 模式 + 各 controller / scheduler
--      的 where + orderBy 组合，对照各表 V1/V9/V10/V18 的现有索引识别盲区。
-- 原则：每条索引都对应一个具体的现有热查询；不做投机性补索引。
-- 详细复盘见 docs/性能优化复盘.md
-- ============================================

-- ----- product_price_history / product_inventory_history -----
-- 现有：idx_variant_changed (store_id, variant_external_id, changed_at)
--       idx_tenant_changed   (tenant_id, changed_at)
-- 缺口：ProductSnapshotController 详情接口按 (store_id, product_external_id)
--       聚合最近 10 条价格/库存变更（不带 variant_external_id），现有索引只能
--       走 store_id 前缀，filesort + 大量回表。
CREATE INDEX idx_pricehist_store_product_changed
    ON product_price_history (store_id, product_external_id, changed_at);

CREATE INDEX idx_invhist_store_product_changed
    ON product_inventory_history (store_id, product_external_id, changed_at);

-- ----- task -----
-- 现有：idx_tenant_type_created (tenant_id, type, created_at)
--       idx_status_created       (status, created_at)
--       idx_parent               (parent_task_id)
--       idx_store                (store_id, type, created_at)
--       idx_task_saga_step       (type, saga_step, status)
-- 缺口：TaskController.list() 仅按 type 过滤 + ORDER BY id DESC（无 tenant），
--       现有索引前缀都不匹配 → 全表扫 + filesort。
--       业务上跨 tenant 的 ops 视图也按 type 单独检索，需要 (type, id) 覆盖排序。
CREATE INDEX idx_task_type_id
    ON task (type, id);

-- ----- product_snapshot -----
-- 现有：idx_store_product   (store_id, product_external_id, created_at)
--       idx_tenant_created  (tenant_id, created_at)
--       idx_status          (status, created_at)
-- 缺口：ProductSnapshotController.list() 三个可选过滤组合中 (storeId, status)
--       是 UI 默认刷的入口，但现有 idx_store_product 第二列是 product_external_id
--       而非 status。补 (store_id, status, created_at) 让 store + 状态视图直接命中。
CREATE INDEX idx_snapshot_store_status_created
    ON product_snapshot (store_id, status, created_at);

-- ----- store_product -----
-- 现有：uk_store_product (store_id, product_id) UNIQUE
--       idx_shopify_product (store_id, shopify_product_id)
--       idx_tenant_status   (tenant_id, status)
-- 缺口：tenant 维度的产品映射列表 UI 是 ORDER BY updated_at DESC（最近变更优先），
--       idx_tenant_status 没有 updated_at 列，列表分页要 filesort。
--       覆盖列加上 updated_at 即可避免文件排序。
CREATE INDEX idx_storeprod_tenant_status_updated
    ON store_product (tenant_id, status, updated_at);

-- ----- user_invitation -----
-- 现有：idx_email_status     (email, status)
--       idx_token            (invitation_token)
--       idx_account_expires  (account_expires_at)
-- 缺口：InvitationServiceImpl.list() 仅按 status 过滤 + ORDER BY invited_at DESC，
--       email 不传时 idx_email_status 用不上，导致全表扫。
CREATE INDEX idx_invitation_status_invited
    ON user_invitation (status, invited_at);

-- ----- 说明 -----
-- 已检查不需要补的：
--   sys_audit_log: 仍然只写不查（无 controller 检索接口），现有 idx_user_created /
--                  idx_module_created / idx_created_at 已覆盖未来 console 视图。
--   preview_theme: V18 三个索引已覆盖 cleanup（expires_at,status）+ allocator
--                  (dev_store_id,status,created_at) + 列表 (source_product_id,status)。
--   sys_data_scope: V19 已加 cross_company 通知窗口索引。
--   product_snapshot.completed_at: 现阶段无 "最近成功快照" 视图，暂不补。
