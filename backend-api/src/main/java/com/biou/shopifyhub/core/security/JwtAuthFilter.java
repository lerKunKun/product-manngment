package com.biou.shopifyhub.core.security;

import com.biou.shopifyhub.core.tenant.TenantContext;
import com.biou.shopifyhub.rbac.UserRolePermissionService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collection;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);
    private static final String BEARER = "Bearer ";

    private final JwtUtil jwtUtil;
    private final StringRedisTemplate redis;
    private final SessionService sessionService;
    private final UserRolePermissionService rbac;

    public JwtAuthFilter(JwtUtil jwtUtil, StringRedisTemplate redis, SessionService sessionService,
                         UserRolePermissionService rbac) {
        this.jwtUtil = jwtUtil;
        this.redis = redis;
        this.sessionService = sessionService;
        this.rbac = rbac;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse resp, FilterChain chain)
        throws ServletException, IOException {

        String authHeader = req.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith(BEARER)) {
            String token = authHeader.substring(BEARER.length());
            try {
                if (Boolean.TRUE.equals(redis.hasKey("auth:blacklist:" + token))) {
                    throw new JwtException("token blacklisted");
                }
                Claims c = jwtUtil.parse(token);
                Long userId = Long.parseLong(c.getSubject());
                String username = c.get("uname", String.class);
                Long tenantId = c.get("tid", Long.class);
                String sid = c.get("sid", String.class);

                // 没 sid（旧 token） 或 session 已被踢 → 拒签（让 SecurityFilterChain 抛 401）
                if (sid == null || !sessionService.exists(userId, sid)) {
                    throw new JwtException("session revoked");
                }

                TenantContext.set(tenantId, null, userId, username, sid);

                // RBAC：从 sys_user_role / sys_role_permission 解析当前实际授权（带 Redis cache）。
                // 之前硬编码 ROLE_USER 让所有登录用户在 Spring Security 看来等价 → 任意 admin
                // endpoint 都能进。改为按用户实际角色 + 权限码构 authorities，配合 SecurityConfig
                // 的 hasRole / hasAuthority 做 endpoint 级拦截。
                Collection<GrantedAuthority> authorities = rbac.loadAuthorities(userId);
                UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                    username, null, authorities
                );
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (JwtException | IllegalArgumentException | IllegalStateException e) {
                log.debug("JWT parse/session check failed: {}", e.getMessage());
            }
        }

        try {
            chain.doFilter(req, resp);
        } finally {
            TenantContext.clear();
            SecurityContextHolder.clearContext();
        }
    }
}
