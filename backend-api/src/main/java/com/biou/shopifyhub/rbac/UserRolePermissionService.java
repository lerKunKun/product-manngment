package com.biou.shopifyhub.rbac;

import com.biou.shopifyhub.core.cache.CacheKeys;
import com.biou.shopifyhub.core.cache.CacheService;
import com.fasterxml.jackson.core.type.TypeReference;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * RBAC 运行时解析：把 userId → 当前生效的角色码 + 权限码 列表，带 Redis cache。
 *
 * <p>消费者：
 * <ul>
 *   <li>{@code JwtAuthFilter}：每次受保护请求构建 Spring Security authority 列表</li>
 *   <li>{@code AuthService.me()} / {@code refresh}：把 roles + permissions 灌进响应让前端 gate UI</li>
 * </ul>
 *
 * <p>缓存策略：
 * <ul>
 *   <li>TTL 走 {@code cache.default-ttl-seconds}（默认 5 分钟）</li>
 *   <li>角色 / 权限 / 角色绑定 mutate 时调用 {@link #invalidate(Long)} / {@link #invalidateAll()}</li>
 *   <li>Redis 异常自动 fallback 到 DB（{@link CacheService} 已经 swallow exceptions）</li>
 * </ul>
 *
 * <p>Authority 命名约定（与 Spring Security 默认惯例兼容）：
 * <ul>
 *   <li>角色 → {@code "ROLE_<CODE>"}，如 {@code ROLE_PLATFORM_SUPER}（{@code hasRole("PLATFORM_SUPER")} 自动加前缀）</li>
 *   <li>权限 → {@code "PERM_<CODE>"}，如 {@code PERM_PRODUCT:READ}（{@code hasAuthority("PERM_PRODUCT:READ")}）</li>
 * </ul>
 */
@Service
public class UserRolePermissionService {

    /** authority 前缀：与 Spring Security 默认 hasRole / hasAuthority 解析方式对齐 */
    public static final String ROLE_PREFIX = "ROLE_";
    public static final String PERM_PREFIX = "PERM_";

    private final JdbcTemplate jdbc;
    private final CacheService cache;

    public UserRolePermissionService(JdbcTemplate jdbc, CacheService cache) {
        this.jdbc = jdbc;
        this.cache = cache;
    }

    /** 取用户当前角色码列表（去重）。 */
    public List<String> loadRoles(Long userId) {
        if (userId == null) return List.of();
        return cache.getOrLoad(
            CacheKeys.userRoles(userId),
            "rbac_user_roles",
            new TypeReference<List<String>>() {},
            () -> jdbc.queryForList(
                "SELECT DISTINCT r.code FROM sys_role r " +
                "JOIN sys_user_role ur ON ur.role_id = r.id " +
                "WHERE ur.user_id = ?",
                String.class, userId
            )
        );
    }

    /** 取用户当前权限码列表（已通过角色聚合并去重）。 */
    public List<String> loadPermissions(Long userId) {
        if (userId == null) return List.of();
        return cache.getOrLoad(
            CacheKeys.userPermissions(userId),
            "rbac_user_perms",
            new TypeReference<List<String>>() {},
            () -> jdbc.queryForList(
                "SELECT DISTINCT p.code FROM sys_permission p " +
                "JOIN sys_role_permission rp ON rp.permission_id = p.id " +
                "JOIN sys_user_role ur ON ur.role_id = rp.role_id " +
                "WHERE ur.user_id = ?",
                String.class, userId
            )
        );
    }

    /** 给 Spring Security 用的合并 authority 列表（ROLE_* + PERM_*）。 */
    public Collection<GrantedAuthority> loadAuthorities(Long userId) {
        List<String> roles = loadRoles(userId);
        List<String> perms = loadPermissions(userId);
        List<GrantedAuthority> out = new ArrayList<>(roles.size() + perms.size());
        for (String r : roles) out.add(new SimpleGrantedAuthority(ROLE_PREFIX + r));
        for (String p : perms) out.add(new SimpleGrantedAuthority(PERM_PREFIX + p));
        return out;
    }

    /** 用户的角色 / 权限发生变更时调用（assignRoles / role-perm reset / 用户冻结等）。 */
    public void invalidate(Long userId) {
        if (userId == null) return;
        cache.invalidate(CacheKeys.userRoles(userId));
        cache.invalidate(CacheKeys.userPermissions(userId));
    }

    /** 全局重置（如 V33-style 角色 × 权限矩阵被 reset）。生产慎用。 */
    public void invalidateAll() {
        cache.invalidatePrefix("cache:rbac:user:");
    }
}
