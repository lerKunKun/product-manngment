package com.biou.shopifyhub.auth.controller;

import com.biou.shopifyhub.auth.dto.LoginRequest;
import com.biou.shopifyhub.auth.dto.LoginResponse;
import com.biou.shopifyhub.auth.service.AuthService;
import com.biou.shopifyhub.core.Result;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService service;

    public AuthController(AuthService service) {
        this.service = service;
    }

    @PostMapping("/login")
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest req, HttpServletRequest http) {
        String ip = http.getHeader("X-Forwarded-For");
        if (ip == null || ip.isBlank()) ip = http.getRemoteAddr();
        return Result.ok(service.loginWithPassword(req, ip));
    }

    @PostMapping("/logout")
    public Result<Void> logout(@RequestHeader(value = "Authorization", required = false) String auth) {
        String token = auth == null ? null : auth.replace("Bearer ", "");
        service.logout(token);
        return Result.ok();
    }
}
