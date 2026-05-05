package com.biou.shopifyhub.template;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * AS6 · 模板版本独立 CRUD endpoints（{@code /base-template-version}）。
 *
 * <p>权限：复用现有 {@code PERM_PLATFORM:TEMPLATE_MANAGE}（V2 RBAC seed 已注册）。
 * 读路径放宽给所有 authed 用户（与 BaseTemplateController 行为一致）；
 * 写路径要求 {@code PLATFORM:TEMPLATE_MANAGE}。
 *
 * <p>TODO: 等专属权限码 PERM_TEMPLATE:READ / PERM_TEMPLATE:WRITE 上线后切换。
 */
@RestController
@RequestMapping("/base-template-version")
public class BaseTemplateVersionController {

    private final BaseTemplateVersionService service;

    public BaseTemplateVersionController(BaseTemplateVersionService service) {
        this.service = service;
    }

    @GetMapping
    public Result<Page<Map<String, Object>>> list(@RequestParam(defaultValue = "1") int page,
                                                  @RequestParam(defaultValue = "20") int size,
                                                  @RequestParam(required = false) String keyword) {
        return Result.ok(service.list(page, size, keyword));
    }

    @GetMapping("/{id}")
    public Result<Map<String, Object>> detail(@PathVariable Long id) {
        return Result.ok(service.detail(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    public Result<Long> create(@RequestBody BaseTemplateVersionService.CreateRequest req) {
        return Result.ok(service.create(req, CurrentUser.userIdOrNull()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    public Result<Void> update(@PathVariable Long id,
                               @RequestBody BaseTemplateVersionService.UpdateRequest req) {
        service.update(id, req);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    public Result<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return Result.ok();
    }
}
