package com.biou.shopifyhub.product.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.cache.CacheKeys;
import com.biou.shopifyhub.core.cache.CacheService;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 产品图片的删除与重排序。
 *
 * <p><b>注意</b>：本端点仅操作 product_image 表，不会同步删 R2 对象（R2 清理由
 * 后续 F2 子轨道的存储清理 job 处理）。这样可以避免误删后 R2 已经丢失的尴尬。
 */
@RestController
public class ProductImageController {

    private final ProductImageMapper mapper;
    private final CacheService cacheService;

    public ProductImageController(ProductImageMapper mapper, CacheService cacheService) {
        this.mapper = mapper;
        this.cacheService = cacheService;
    }

    @DeleteMapping("/product-image/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        ProductImage img = mapper.selectById(id);
        if (img == null) throw new BusinessException(ResultCode.NOT_FOUND);
        mapper.deleteById(id);
        cacheService.invalidate(CacheKeys.productDetail(img.getProductId()));
        return Result.ok();
    }

    /**
     * 批量按 id 顺序重排 position（1-based）。前端拖拽完拿到新 id 数组传过来。
     * 不强校验 ids 是否覆盖全表，做开放式：传哪些就改哪些。
     */
    @PostMapping("/product/{productId}/image/reorder")
    @Transactional
    public Result<Map<String, Integer>> reorder(@PathVariable Long productId, @RequestBody ReorderReq req) {
        if (req.ids == null || req.ids.isEmpty()) {
            return Result.ok(Map.of("updated", 0));
        }
        List<ProductImage> rows = mapper.selectList(new QueryWrapper<ProductImage>()
            .eq("product_id", productId));
        Map<Long, ProductImage> byId = new HashMap<>();
        for (ProductImage r : rows) byId.put(r.getId(), r);
        int updated = 0;
        for (int i = 0; i < req.ids.size(); i++) {
            ProductImage r = byId.get(req.ids.get(i));
            if (r == null) continue;
            r.setPosition(i + 1);
            mapper.updateById(r);
            updated++;
        }
        cacheService.invalidate(CacheKeys.productDetail(productId));
        return Result.ok(Map.of("updated", updated));
    }

    public static class ReorderReq { public List<Long> ids; }
}
