package com.biou.shopifyhub.core;

import com.biou.shopifyhub.core.security.JwtAuthFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {

    private final JwtAuthFilter jwtFilter;

    public SecurityConfig(JwtAuthFilter jwtFilter) {
        this.jwtFilter = jwtFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // 健康检查 / actuator
                .requestMatchers("/health/**", "/actuator/**").permitAll()
                // 登录 / 钉钉 OAuth / 邀请预览接受 / Swagger / OAuth 回调
                .requestMatchers(HttpMethod.POST, "/auth/login", "/auth/logout").permitAll()
                .requestMatchers("/auth/dingtalk/qrcode", "/auth/dingtalk/callback", "/auth/dingtalk/event").permitAll()
                .requestMatchers("/auth/password-reset/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/invitation/preview", "/asset/snapshot/*/events", "/saga/*/events").permitAll()
                .requestMatchers(HttpMethod.POST, "/invitation/accept").permitAll()
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                .requestMatchers("/oauth/**", "/webhook/**", "/internal/asset/**").permitAll()
                .requestMatchers("/ops/backup/**").permitAll()
                // Wave 0 阶段：未登录可访问的开放路径列表 ↑；其余需要 JWT
                // Wave 1 后期：开启严格鉴权，去掉 anyRequest().permitAll()
                .anyRequest().permitAll()      // TODO: 改 .authenticated() 在 W1-RBAC 完成后
            )
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .formLogin(form -> form.disable())
            .httpBasic(basic -> basic.disable());
        return http.build();
    }
}
