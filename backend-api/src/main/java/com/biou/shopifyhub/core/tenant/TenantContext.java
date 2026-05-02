package com.biou.shopifyhub.core.tenant;

/**
 * 租户与登录用户上下文。Wave 1 完整化：
 * - host → tenantCode 解析（前置拦截器）
 * - JWT subject → userId / username
 *
 * Wave 0 阶段仅作骨架；尚未接入拦截器。
 */
public final class TenantContext {

    private static final ThreadLocal<Ctx> HOLDER = new ThreadLocal<>();

    private TenantContext() {}

    public static void set(Long tenantId, String tenantCode, Long userId, String username) {
        HOLDER.set(new Ctx(tenantId, tenantCode, userId, username));
    }

    public static Ctx current() { return HOLDER.get(); }

    public static Long tenantId() { return HOLDER.get() == null ? null : HOLDER.get().tenantId; }

    public static Long userId() { return HOLDER.get() == null ? null : HOLDER.get().userId; }

    public static String username() { return HOLDER.get() == null ? null : HOLDER.get().username; }

    public static void clear() { HOLDER.remove(); }

    public record Ctx(Long tenantId, String tenantCode, Long userId, String username) {}
}
