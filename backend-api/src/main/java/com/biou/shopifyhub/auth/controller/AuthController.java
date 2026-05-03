package com.biou.shopifyhub.auth.controller;

import com.biou.shopifyhub.auth.dto.LoginRequest;
import com.biou.shopifyhub.auth.dto.LoginResponse;
import com.biou.shopifyhub.auth.dto.LoginResult;
import com.biou.shopifyhub.auth.service.AuthService;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.security.CookieUtil;
import com.biou.shopifyhub.core.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService service;
    private final CookieUtil cookieUtil;

    public AuthController(AuthService service, CookieUtil cookieUtil) {
        this.service = service;
        this.cookieUtil = cookieUtil;
    }

    @PostMapping("/login")
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest req,
                                        HttpServletRequest http,
                                        HttpServletResponse resp) {
        String ip = clientIp(http);
        String ua = http.getHeader("User-Agent");
        LoginResult result = service.loginWithPassword(req, ip, ua);
        cookieUtil.writeRefresh(resp, result.refreshToken());
        return Result.ok(result.response());
    }

    @PostMapping("/refresh")
    public Result<LoginResponse> refresh(HttpServletRequest http, HttpServletResponse resp) {
        String token = cookieUtil.readRefresh(http);
        LoginResult result = service.refresh(token, clientIp(http), http.getHeader("User-Agent"));
        cookieUtil.writeRefresh(resp, result.refreshToken());
        return Result.ok(result.response());
    }

    @PostMapping("/logout")
    public Result<Void> logout(@RequestHeader(value = "Authorization", required = false) String auth,
                                HttpServletResponse resp) {
        String token = auth == null ? null : auth.replace("Bearer ", "");
        Long uid = CurrentUser.userIdOrNull();
        String sid = TenantContext.sid();
        service.logout(token, uid, sid);
        cookieUtil.clearRefresh(resp);
        return Result.ok();
    }

    @GetMapping("/me")
    public Result<Map<String, Object>> me() {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) throw new BusinessException(ResultCode.UNAUTHORIZED);
        java.util.HashMap<String, Object> m = new java.util.HashMap<>();
        m.put("userId", uid);
        m.put("username", CurrentUser.username());
        m.put("sid", TenantContext.sid());
        return Result.ok(m);
    }

    @GetMapping("/sessions")
    public Result<List<AuthService.SessionView>> sessions() {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) throw new BusinessException(ResultCode.UNAUTHORIZED);
        return Result.ok(service.listSessions(uid, TenantContext.sid()));
    }

    @PostMapping("/sessions/kick-others")
    public Result<Map<String, Long>> kickOthers() {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) throw new BusinessException(ResultCode.UNAUTHORIZED);
        long n = service.kickOthers(uid, TenantContext.sid());
        return Result.ok(Map.of("kicked", n));
    }

    private static String clientIp(HttpServletRequest req) {
        String ip = req.getHeader("X-Forwarded-For");
        if (ip == null || ip.isBlank()) ip = req.getRemoteAddr();
        else ip = ip.split(",")[0].trim();
        return ip;
    }
}
