package com.biou.shopifyhub.product.controller;

import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.product.entity.Product;
import com.biou.shopifyhub.product.service.ProductService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/product")
public class ProductController {

    private final ProductService service;

    public ProductController(ProductService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public Result<Map<String, Object>> list(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) String keyword,
        @RequestParam(required = false) String status,
        @RequestParam(required = false) Long ownerCompanyId
    ) {
        // 走 listWithCardInfo：返回的 records 是已带 mainImageUrl/price/shelfStores
        // 卡片化字段的 Map，前端列表页直接渲染，不必再请求详情。
        return Result.ok(service.listWithCardInfo(page, size, keyword, status, ownerCompanyId));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public Result<Map<String, Object>> detail(@PathVariable Long id) {
        return Result.ok(service.detail(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    public Result<Map<String, Long>> create(@RequestBody Product input) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        Long id = service.create(input, uid);
        return Result.ok(Map.of("id", id));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    public Result<Void> update(@PathVariable Long id, @RequestBody Product patch) {
        service.update(id, patch);
        return Result.ok();
    }

    /** 删除产品需要二次确认 */
    @RequireSensitiveOp("PRODUCT_DELETE")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:DELETE')")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return Result.ok();
    }

    /** 批量删除产品（危险） */
    @RequireSensitiveOp("PRODUCT_BATCH_DELETE")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:DELETE')")
    @PostMapping("/batch/delete")
    public Result<Map<String, Integer>> batchDelete(@RequestBody BatchIdsReq req) {
        if (req.ids == null || req.ids.isEmpty()) {
            return Result.ok(Map.of("deleted", 0));
        }
        int n = 0;
        for (Long id : req.ids) {
            try { service.delete(id); n++; } catch (Exception ignored) {}
        }
        return Result.ok(Map.of("deleted", n));
    }

    /** 批量改状态 */
    @PostMapping("/batch/status")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:WRITE')")
    public Result<Map<String, Integer>> batchStatus(@RequestBody BatchStatusReq req) {
        if (req.ids == null || req.ids.isEmpty()) {
            return Result.ok(Map.of("updated", 0));
        }
        int n = 0;
        for (Long id : req.ids) {
            try {
                com.biou.shopifyhub.product.entity.Product patch =
                    new com.biou.shopifyhub.product.entity.Product();
                patch.setStatus(req.status);
                patch.setPublished("active".equals(req.status));
                service.update(id, patch);
                n++;
            } catch (Exception ignored) {}
        }
        return Result.ok(Map.of("updated", n));
    }

    public static class BatchIdsReq { public java.util.List<Long> ids; }
    public static class BatchStatusReq { public java.util.List<Long> ids; public String status; }
}
