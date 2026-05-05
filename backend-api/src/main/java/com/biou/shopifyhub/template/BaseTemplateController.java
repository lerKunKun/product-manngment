package com.biou.shopifyhub.template;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.template.entity.BaseTemplate;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * W3-TPL-02: 基础模板 CRUD + 版本管理 + R2 zip 上传。
 *
 * <p>权限：删除/发布/弃用/版本上传走 {@link RequireSensitiveOp} 钉钉验证码二次确认。
 * PLATFORM_SUPER 角色限制 TODO（W3-RBAC 落地后激活）。
 */
@RestController
@RequestMapping("/template")
public class BaseTemplateController {

    private final BaseTemplateService service;
    private final ObjectMapper objectMapper;

    public BaseTemplateController(BaseTemplateService service, ObjectMapper objectMapper) {
        this.service = service;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public Result<Page<BaseTemplate>> list(@RequestParam(defaultValue = "1") int page,
                                           @RequestParam(defaultValue = "20") int size,
                                           @RequestParam(required = false) String category,
                                           @RequestParam(required = false) String status,
                                           @RequestParam(required = false) String keyword) {
        return Result.ok(service.list(page, size, category, status, keyword));
    }

    @GetMapping("/{id}")
    public Result<Map<String, Object>> detail(@PathVariable Long id) {
        return Result.ok(service.detail(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    public Result<Long> create(@RequestBody BaseTemplateService.CreateRequest req) {
        // RBAC P3.4: 模板管理是平台级动作（运营 / 一键开店都依赖共享模板库），仅
        // PLATFORM:TEMPLATE_MANAGE 权限可改。读路径（list/detail）放宽给所有 authed 用户。
        return Result.ok(service.create(req, CurrentUser.userIdOrNull()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    public Result<Void> update(@PathVariable Long id, @RequestBody BaseTemplateService.UpdateRequest req) {
        // RBAC P3.4: 模板管理是平台级动作（运营 / 一键开店都依赖共享模板库），仅
        // PLATFORM:TEMPLATE_MANAGE 权限可改。读路径（list/detail）放宽给所有 authed 用户。
        service.update(id, req);
        return Result.ok();
    }

    @PostMapping("/{id}/publish")
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    @RequireSensitiveOp("TEMPLATE_PUBLISH")
    public Result<Void> publish(@PathVariable Long id) {
        // RBAC P3.4: 模板管理是平台级动作（运营 / 一键开店都依赖共享模板库），仅
        // PLATFORM:TEMPLATE_MANAGE 权限可改。读路径（list/detail）放宽给所有 authed 用户。
        service.publish(id);
        return Result.ok();
    }

    @PostMapping("/{id}/deprecate")
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    @RequireSensitiveOp("TEMPLATE_DEPRECATE")
    public Result<Void> deprecate(@PathVariable Long id) {
        // RBAC P3.4: 模板管理是平台级动作（运营 / 一键开店都依赖共享模板库），仅
        // PLATFORM:TEMPLATE_MANAGE 权限可改。读路径（list/detail）放宽给所有 authed 用户。
        service.deprecate(id);
        return Result.ok();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    @RequireSensitiveOp("TEMPLATE_DELETE")
    public Result<Void> delete(@PathVariable Long id) {
        // RBAC P3.4: 模板管理是平台级动作（运营 / 一键开店都依赖共享模板库），仅
        // PLATFORM:TEMPLATE_MANAGE 权限可改。读路径（list/detail）放宽给所有 authed 用户。
        service.delete(id);
        return Result.ok();
    }

    /** 上传新版本（zip multipart）。 */
    @PostMapping("/{id}/version")
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    @RequireSensitiveOp("TEMPLATE_VERSION_UPLOAD")
    public Result<Long> uploadVersion(@PathVariable Long id,
                                      @RequestParam("version") String version,
                                      @RequestParam(value = "changelog", required = false) String changelog,
                                      @RequestParam(value = "defaultReplaceRules", required = false) String defaultReplaceRulesJson,
                                      @RequestParam("file") MultipartFile file) throws Exception {
        // RBAC P3.4: 模板管理是平台级动作（运营 / 一键开店都依赖共享模板库），仅
        // PLATFORM:TEMPLATE_MANAGE 权限可改。读路径（list/detail）放宽给所有 authed 用户。
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "file empty");
        }
        if (file.getSize() > 100L * 1024 * 1024) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "zip > 100MB");
        }
        Map<String, Object> rules = null;
        if (defaultReplaceRulesJson != null && !defaultReplaceRulesJson.isBlank()) {
            try {
                rules = objectMapper.readValue(defaultReplaceRulesJson, new TypeReference<Map<String, Object>>() {});
            } catch (Exception e) {
                throw new BusinessException(ResultCode.VALIDATION_FAILED, "defaultReplaceRules JSON 解析失败");
            }
        }
        Long vid = service.uploadVersion(id, version, file.getBytes(), rules, changelog, CurrentUser.userIdOrNull());
        return Result.ok(vid);
    }

    @PostMapping("/{id}/default-version/{versionId}")
    @PreAuthorize("hasAuthority('PERM_PLATFORM:TEMPLATE_MANAGE')")
    public Result<Void> setDefaultVersion(@PathVariable Long id, @PathVariable Long versionId) {
        // RBAC P3.4: 模板管理是平台级动作（运营 / 一键开店都依赖共享模板库），仅
        // PLATFORM:TEMPLATE_MANAGE 权限可改。读路径（list/detail）放宽给所有 authed 用户。
        service.setDefaultVersion(id, versionId);
        return Result.ok();
    }
}
