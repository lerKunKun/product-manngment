package com.biou.shopifyhub.product.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.product.entity.ProductExternalLink;
import com.biou.shopifyhub.product.mapper.ProductExternalLinkMapper;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
public class ExternalLinkController {

    private static final Set<String> ALLOWED_KINDS = Set.of("AD", "BENCHMARK", "MATERIAL");

    private final ProductExternalLinkMapper mapper;

    public ExternalLinkController(ProductExternalLinkMapper mapper) {
        this.mapper = mapper;
    }

    @GetMapping("/product/{productId}/external-link")
    public Result<List<ProductExternalLink>> list(@PathVariable Long productId) {
        return Result.ok(mapper.selectList(new QueryWrapper<ProductExternalLink>()
            .eq("product_id", productId)
            .orderByDesc("created_at")));
    }

    @PostMapping("/product/{productId}/external-link")
    public Result<Map<String, Long>> create(@PathVariable Long productId, @RequestBody ProductExternalLink input) {
        validate(input);
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        input.setProductId(productId);
        input.setCreatedBy(uid);
        input.setCreatedAt(LocalDateTime.now());
        mapper.insert(input);
        return Result.ok(Map.of("id", input.getId()));
    }

    @PutMapping("/external-link/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody ProductExternalLink patch) {
        ProductExternalLink cur = mapper.selectById(id);
        if (cur == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (patch.getKind() != null) {
            if (!ALLOWED_KINDS.contains(patch.getKind()))
                throw new BusinessException(ResultCode.VALIDATION_FAILED, "kind 仅允许 AD/BENCHMARK/MATERIAL");
            cur.setKind(patch.getKind());
        }
        if (patch.getUrl() != null) cur.setUrl(patch.getUrl());
        if (patch.getNote() != null) cur.setNote(patch.getNote());
        mapper.updateById(cur);
        return Result.ok();
    }

    @DeleteMapping("/external-link/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        mapper.deleteById(id);
        return Result.ok();
    }

    private void validate(ProductExternalLink input) {
        if (input.getKind() == null || !ALLOWED_KINDS.contains(input.getKind())) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "kind 必填且为 AD/BENCHMARK/MATERIAL");
        }
        if (input.getUrl() == null || input.getUrl().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "url 必填");
        }
    }
}
