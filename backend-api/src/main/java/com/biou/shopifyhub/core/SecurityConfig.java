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
                .requestMatchers(HttpMethod.GET, "/invitation/preview", "/asset/snapshot/*/events", "/saga/*/events", "/task/*/events").permitAll()
                .requestMatchers(HttpMethod.POST, "/invitation/accept").permitAll()
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                .requestMatchers("/oauth/**", "/webhook/**", "/internal/asset/**").permitAll()
                .requestMatchers("/internal/**").permitAll()
                .requestMatchers("/ops/backup/**").permitAll()
                // T1：开放路径列表 ↑；其余必须带 JWT
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .formLogin(form -> form.disable())
            .httpBasic(basic -> basic.disable());
        return http.build();
    }
}
