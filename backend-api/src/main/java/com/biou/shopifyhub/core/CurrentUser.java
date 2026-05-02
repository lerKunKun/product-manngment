package com.biou.shopifyhub.core;

import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.tenant.TenantContext;

/**
 * 工具：从 ThreadLocal 拿当前登录用户。未登录时根据需要抛 401 或返回 null。
 */
public final class CurrentUser {

    private CurrentUser() {}

    public static Long userIdOrNull() {
        return TenantContext.userId();
    }

    public static Long userIdOrThrow() {
        Long id = TenantContext.userId();
        if (id == null) throw new BusinessException(ResultCode.UNAUTHORIZED);
        return id;
    }

    public static String username() {
        return TenantContext.username();
    }

    public static Long tenantId() {
        return TenantContext.tenantId();
    }
}
