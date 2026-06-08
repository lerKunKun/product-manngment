-- 允许 worker 将 Shopify validation error 持久化为待处理冲突。
-- 代码路径：PushService.mapConflictType("VALIDATION") -> push_conflict.conflict_type。
ALTER TABLE push_conflict
    MODIFY COLUMN conflict_type ENUM(
        'HANDLE_TAKEN',
        'SKU_DUPLICATE',
        'VARIANT_OPTION_MISMATCH',
        'VALIDATION',
        'OTHER'
    ) NOT NULL COMMENT '冲突类型：HANDLE_TAKEN=handle 占用 / SKU_DUPLICATE=SKU 重复 / VARIANT_OPTION_MISMATCH=选项不匹配 / VALIDATION=Shopify 参数校验失败 / OTHER=其他';
