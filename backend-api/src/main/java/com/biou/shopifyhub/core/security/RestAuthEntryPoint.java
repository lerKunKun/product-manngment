package com.biou.shopifyhub.core.security;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * 把 Spring Security 默认的 403/空 body 改成 JSON {code:10001, message, ts}，HTTP 401。
 *
 * 为什么重要：
 *  - 前端 client.ts 凭 body.code === 10001 触发 auto-refresh
 *  - 默认 Http403ForbiddenEntryPoint 直接返回空 body 403，前端 resp.json() 失败 fallback 成 "HTTP 403"，
 *    既无法识别也无法重放 → 用户看到 Runtime Error
 */
@Component
public class RestAuthEntryPoint implements AuthenticationEntryPoint, AccessDeniedHandler {

    private final ObjectMapper mapper;

    public RestAuthEntryPoint(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException authException) throws IOException {
        // 未登录 / token 失效 → 401 + code 10001（前端 client.ts 据此触发 auto-refresh）
        write(response, HttpServletResponse.SC_UNAUTHORIZED, ResultCode.UNAUTHORIZED);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
                       AccessDeniedException accessDeniedException) throws IOException {
        // 已认证但无权限 → 403 + code 10002。前端必须区分：
        // 10001 → refresh + retry；10002 → 直接 toast 提示，不要 refresh-loop，不要踢去 /login
        write(response, HttpServletResponse.SC_FORBIDDEN, ResultCode.FORBIDDEN);
    }

    private void write(HttpServletResponse resp, int status, ResultCode code) throws IOException {
        resp.setStatus(status);
        resp.setContentType(MediaType.APPLICATION_JSON_VALUE);
        resp.setCharacterEncoding("UTF-8");
        resp.getWriter().write(mapper.writeValueAsString(Result.error(code, "")));
    }
}
