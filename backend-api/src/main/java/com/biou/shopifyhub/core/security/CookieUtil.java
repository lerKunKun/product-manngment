package com.biou.shopifyhub.core.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 把 refresh token 写进 httpOnly cookie，JS（含 XSS）拿不到。
 *
 * - HttpOnly       — JS 不可读
 * - SameSite=Lax   — 跨站 GET 不带；表单/链接进入站内会带，对 JSON POST API 足够
 * - Secure         — 仅生产开（dev 走 http://localhost）
 * - Path=/api/auth — 只对 auth 端点带 cookie，缩小攻击面（refresh / logout / sessions）
 */
@Component
public class CookieUtil {

    public static final String REFRESH_COOKIE = "shub_refresh";
    private static final String COOKIE_PATH = "/api/auth";

    private final boolean secure;
    private final long maxAgeSec;

    public CookieUtil(Environment env, @Value("${jwt.refresh-ttl:7d}") Duration refreshTtl) {
        // 任何 prod profile 都打开 Secure
        boolean isProd = false;
        for (String p : env.getActiveProfiles()) {
            if (p.equalsIgnoreCase("prod") || p.equalsIgnoreCase("production")) {
                isProd = true;
                break;
            }
        }
        this.secure = isProd;
        this.maxAgeSec = refreshTtl.getSeconds();
    }

    public void writeRefresh(HttpServletResponse resp, String token) {
        // Spring 的 Cookie 不直接支持 SameSite，手写 Set-Cookie 头确保 SameSite=Lax 落地
        StringBuilder sb = new StringBuilder();
        sb.append(REFRESH_COOKIE).append('=').append(token);
        sb.append("; Path=").append(COOKIE_PATH);
        sb.append("; Max-Age=").append(maxAgeSec);
        sb.append("; HttpOnly");
        sb.append("; SameSite=Lax");
        if (secure) sb.append("; Secure");
        resp.addHeader("Set-Cookie", sb.toString());
    }

    public void clearRefresh(HttpServletResponse resp) {
        StringBuilder sb = new StringBuilder();
        sb.append(REFRESH_COOKIE).append('=');
        sb.append("; Path=").append(COOKIE_PATH);
        sb.append("; Max-Age=0");
        sb.append("; HttpOnly");
        sb.append("; SameSite=Lax");
        if (secure) sb.append("; Secure");
        resp.addHeader("Set-Cookie", sb.toString());
    }

    public String readRefresh(HttpServletRequest req) {
        Cookie[] cookies = req.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (REFRESH_COOKIE.equals(c.getName())) return c.getValue();
        }
        return null;
    }
}
