package com.biou.shopifyhub.template.binding;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Track AS5 — 店铺-模板版本绑定的 CRUD 端点。
 *
 * <p>权限：与 push 一致，{@code PERM_PRODUCT:PUSH}（推送相关流程的"写"权限）。
 */
@RestController
@RequestMapping("/store-template-binding")
public class StoreTemplateBindingController {

    private final StoreTemplateBindingService service;

    public StoreTemplateBindingController(StoreTemplateBindingService service) {
        this.service = service;
    }

    @GetMapping("/{storeId}")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:PUSH')")
    public Result<StoreTemplateBinding> get(@PathVariable Long storeId) {
        // null when not bound — frontend renders an empty selector
        return Result.ok(service.getOrEmpty(storeId));
    }

    @PutMapping("/{storeId}")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:PUSH')")
    public Result<Void> upsert(@PathVariable Long storeId, @RequestBody BindRequest req) {
        service.bind(storeId, req.baseTemplateVersionId(), req.customReplaceRulesJson(), CurrentUser.userIdOrNull());
        return Result.ok(null);
    }

    @DeleteMapping("/{storeId}")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:PUSH')")
    public Result<Void> delete(@PathVariable Long storeId) {
        service.unbind(storeId);
        return Result.ok(null);
    }

    public record BindRequest(Long baseTemplateVersionId, String customReplaceRulesJson) {}
}
