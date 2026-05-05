package com.biou.shopifyhub.core.cache;

/**
 * W3-PERF-01: 集中托管所有 Redis 缓存 key 模板，避免散落在各 Service 里拼字符串。
 *
 * 规则：
 *  - 统一前缀 "cache:"，方便运维 SCAN 清掉一类缓存
 *  - 一类缓存对应一个静态方法，参数即业务标识（tenantId / productId / userId）
 *  - 不在这里管 TTL（TTL 在 {@link CacheService} 里统一控制，避免各 caller 自带）
 */
public final class CacheKeys {
    private CacheKeys() {}

    /** 店铺列表（按 tenant 维度）：W3-PERF-01 仅缓存 tenantId 单参数变体 */
    public static String storeList(Long tenantId) {
        return "cache:store:list:" + tenantId;
    }

    /** 单个产品的详情聚合（含 variants + images），按 productId */
    public static String productDetail(Long productId) {
        return "cache:product:detail:" + productId;
    }

    /** 用户解析后的权限集合（user → permissions），P1.3 RBAC 落地后启用 */
    public static String userPermissions(Long userId) {
        return "cache:rbac:user:" + userId + ":permissions";
    }

    /** 用户角色码集合（user → role codes），P1.3 RBAC 落地后启用 */
    public static String userRoles(Long userId) {
        return "cache:rbac:user:" + userId + ":roles";
    }
}
