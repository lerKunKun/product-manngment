package com.biou.shopifyhub.auth.sensitive;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
public class SensitiveOpController {

    private final SensitiveOpService service;

    public SensitiveOpController(SensitiveOpService service) {
        this.service = service;
    }

    @PostMapping("/auth/sensitive/request")
    public Result<Map<String, Object>> request(@RequestBody RequestCodePayload body) {
        boolean sent = service.requestCode(CurrentUser.userIdOrThrow(), body.action);
        return Result.ok(Map.of("devFallback", !sent));
    }

    @PostMapping("/auth/sensitive/verify")
    public Result<Map<String, String>> verify(@RequestBody VerifyPayload body) {
        String token = service.verify(CurrentUser.userIdOrThrow(), body.action, body.code);
        return Result.ok(Map.of("sensitiveToken", token, "ttl", "5m"));
    }

    /** F4 别名路径（与文档 /auth/sensitive-code/* 对齐）。 */
    @PostMapping("/auth/sensitive-code/send")
    public Result<Map<String, Object>> sendCode(@RequestBody RequestCodePayload body) {
        boolean sent = service.requestCode(CurrentUser.userIdOrThrow(), body.action);
        // devFallback=true 表示钉钉没发出，dev 模式下码已打到后端控制台
        return Result.ok(Map.of("devFallback", !sent));
    }

    @PostMapping("/auth/sensitive-code/verify")
    public Result<Map<String, String>> verifyCode(@RequestBody VerifyPayload body) {
        String token = service.verify(CurrentUser.userIdOrThrow(), body.action, body.code);
        return Result.ok(Map.of("sensitiveToken", token, "ttl", "5m"));
    }

    public static class RequestCodePayload {
        @NotBlank public String action;
    }

    public static class VerifyPayload {
        @NotBlank public String action;
        @NotBlank public String code;
    }
}
