package com.biou.shopifyhub.auth.sensitive;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/auth/sensitive")
public class SensitiveOpController {

    private final SensitiveOpService service;

    public SensitiveOpController(SensitiveOpService service) {
        this.service = service;
    }

    @PostMapping("/request")
    public Result<Void> request(@RequestBody RequestCodePayload body) {
        service.requestCode(CurrentUser.userIdOrThrow(), body.action);
        return Result.ok();
    }

    @PostMapping("/verify")
    public Result<Map<String, String>> verify(@RequestBody VerifyPayload body) {
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
