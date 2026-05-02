package com.biou.shopifyhub.product.controller;

import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.product.entity.ProductVariant;
import com.biou.shopifyhub.product.service.VariantService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
public class VariantController {

    private final VariantService service;

    public VariantController(VariantService service) {
        this.service = service;
    }

    @PostMapping("/product/{productId}/variant")
    public Result<Map<String, Long>> create(
        @PathVariable Long productId,
        @RequestBody ProductVariant input
    ) {
        Long id = service.create(productId, input);
        return Result.ok(Map.of("id", id));
    }

    @PutMapping("/variant/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody ProductVariant patch) {
        service.update(id, patch);
        return Result.ok();
    }

    @DeleteMapping("/variant/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return Result.ok();
    }
}
