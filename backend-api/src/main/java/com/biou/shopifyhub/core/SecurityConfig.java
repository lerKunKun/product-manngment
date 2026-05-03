package com.biou.shopifyhub.core;

import com.biou.shopifyhub.core.security.JwtAuthFilter;
import com.biou.shopifyhub.core.security.RestAuthEntryPoint;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;

@Configuration
public class SecurityConfig {

    /**
     * 全局 Content-Security-Policy（XSS 加固第一道闸）。
     * - default-src 'self'：默认仅允许同源资源
     * - script-src 'self'：禁止 inline / eval / 第三方脚本
     * - style-src 'self' 'unsafe-inline'：tailwind/styled-components 需要 inline，限制到样式
     * - img-src 允许 data: + 同源 + http(s)（产品图、avatar 来自 R2/MinIO）
     * - connect-src 允许同源 + ws/wss（SSE/心跳）
     * - frame-ancestors 'none' 等价 X-Frame-Options DENY，防点击劫持
     * - object-src 'none' 防过期 Flash/插件 SVG
     * 如果将来嵌入第三方（钉钉 H5 等），按需放开对应 host。
     */
    private static final String CSP =
        "default-src 'self'; "
      + "script-src 'self'; "
      + "style-src 'self' 'unsafe-inline'; "
      + "img-src 'self' data: blob: https: http:; "
      + "font-src 'self' data:; "
      + "connect-src 'self' ws: wss:; "
      + "frame-ancestors 'none'; "
      + "object-src 'none'; "
      + "base-uri 'self'; "
      + "form-action 'self'";

    private final JwtAuthFilter jwtFilter;
    private final RestAuthEntryPoint authEntryPoint;

    public SecurityConfig(JwtAuthFilter jwtFilter, RestAuthEntryPoint authEntryPoint) {
        this.jwtFilter = jwtFilter;
        this.authEntryPoint = authEntryPoint;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // CSRF：refresh cookie 已用 SameSite=Lax 防住跨站；JSON API + Bearer 模式无 form 提交，关闭即可
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // 把默认的 403/空 body 改成 JSON {code:10001}，让前端能识别 → auto-refresh
            .exceptionHandling(eh -> eh
                .authenticationEntryPoint(authEntryPoint)
                .accessDeniedHandler(authEntryPoint)
            )
            .headers(h -> h
                .contentSecurityPolicy(c -> c.policyDirectives(CSP))
                .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
                .frameOptions(f -> f.deny())
                .contentTypeOptions(c -> {})  // X-Content-Type-Options: nosniff
                .xssProtection(x -> {})        // X-XSS-Protection: 0（现代 CSP 替代品；Spring 默认 1）
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/health/**", "/actuator/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/auth/login", "/auth/logout", "/auth/refresh").permitAll()
                .requestMatchers("/auth/dingtalk/qrcode", "/auth/dingtalk/callback", "/auth/dingtalk/event").permitAll()
                // /auth/dingtalk/bind/qrcode 必须**已登录**才能发起 → 不加 permitAll
                // /auth/dingtalk/bind/callback 由钉钉浏览器跳转回来，无 Authorization header → permitAll，靠 state HMAC 防伪
                .requestMatchers("/auth/dingtalk/bind/callback").permitAll()
                .requestMatchers("/auth/password-reset/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/invitation/preview", "/asset/snapshot/*/events", "/saga/*/events", "/task/*/events").permitAll()
                .requestMatchers(HttpMethod.POST, "/invitation/accept").permitAll()
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                .requestMatchers("/oauth/**", "/webhook/**", "/internal/asset/**").permitAll()
                .requestMatchers("/internal/**").permitAll()
                .requestMatchers("/ops/backup/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .formLogin(form -> form.disable())
            .httpBasic(basic -> basic.disable());
        return http.build();
    }
}
