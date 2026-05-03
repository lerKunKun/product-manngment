package com.biou.shopifyhub.product.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.product.entity.ProductOption;
import com.biou.shopifyhub.product.mapper.ProductOptionMapper;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 产品 option（变体维度名）查询。
 * 详情页变体表的列头要按 product_option.position 升序展示，因此前端需要单独
 * 拉一次本端点。Wave 1 仅暴露 GET；create / update / delete 的 option 维度
 * 调整目前由 CSV 导入或 admin 直改 DB 完成。
 */
@RestController
public class ProductOptionController {

    private final ProductOptionMapper mapper;

    public ProductOptionController(ProductOptionMapper mapper) {
        this.mapper = mapper;
    }

    @GetMapping("/product/{productId}/option")
    public Result<List<ProductOption>> list(@PathVariable Long productId) {
        return Result.ok(mapper.selectList(new QueryWrapper<ProductOption>()
            .eq("product_id", productId)
            .orderByAsc("position")));
    }
}
