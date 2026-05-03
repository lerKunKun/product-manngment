package com.biou.shopifyhub.product.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.product.entity.ProductMetafield;
import com.biou.shopifyhub.product.mapper.ProductMetafieldMapper;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Product metafields CRUD。Shopify 的 metafield 是 namespace+key+value+type 四元组，
 * 同一 product 下 (namespace, key) 唯一。
 */
@RestController
public class ProductMetafieldController {

    private final ProductMetafieldMapper mapper;

    public ProductMetafieldController(ProductMetafieldMapper mapper) {
        this.mapper = mapper;
    }

    @GetMapping("/product/{productId}/metafield")
    public Result<List<ProductMetafield>> list(@PathVariable Long productId) {
        return Result.ok(mapper.selectList(new QueryWrapper<ProductMetafield>()
            .eq("product_id", productId)
            .orderByAsc("id")));
    }

    @PostMapping("/product/{productId}/metafield")
    public Result<Map<String, Long>> create(@PathVariable Long productId, @RequestBody ProductMetafield input) {
        validate(input);
        input.setProductId(productId);
        // 同 (namespace, key) 已存在则拒绝；前端要 update 走 PUT
        Long existing = mapper.selectCount(new QueryWrapper<ProductMetafield>()
            .eq("product_id", productId)
            .eq("`namespace`", input.getNamespace())
            .eq("`key`", input.getKey()));
        if (existing != null && existing > 0) {
            throw new BusinessException(ResultCode.CONFLICT, "metafield 已存在: " + input.getNamespace() + "." + input.getKey());
        }
        mapper.insert(input);
        return Result.ok(Map.of("id", input.getId()));
    }

    @PutMapping("/metafield/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody ProductMetafield patch) {
        ProductMetafield cur = mapper.selectById(id);
        if (cur == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (patch.getNamespace() != null) cur.setNamespace(patch.getNamespace());
        if (patch.getKey() != null) cur.setKey(patch.getKey());
        if (patch.getValue() != null) cur.setValue(patch.getValue());
        if (patch.getType() != null) cur.setType(patch.getType());
        mapper.updateById(cur);
        return Result.ok();
    }

    @DeleteMapping("/metafield/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        mapper.deleteById(id);
        return Result.ok();
    }

    private void validate(ProductMetafield m) {
        if (m.getNamespace() == null || m.getNamespace().isBlank())
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "namespace 必填");
        if (m.getKey() == null || m.getKey().isBlank())
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "key 必填");
    }
}
