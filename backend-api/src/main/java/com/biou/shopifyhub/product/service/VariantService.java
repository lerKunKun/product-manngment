package com.biou.shopifyhub.product.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.product.entity.ProductVariant;
import com.biou.shopifyhub.product.mapper.ProductVariantMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

@Service
public class VariantService {

    private static final Logger log = LoggerFactory.getLogger(VariantService.class);

    private final ProductVariantMapper mapper;

    public VariantService(ProductVariantMapper mapper) {
        this.mapper = mapper;
    }

    @Transactional
    public Long create(Long productId, ProductVariant input) {
        input.setProductId(productId);
        if (input.getPosition() == null) {
            Long count = mapper.selectCount(new QueryWrapper<ProductVariant>().eq("product_id", productId));
            input.setPosition(count.intValue() + 1);
        }
        if (input.getPrice() == null) input.setPrice(BigDecimal.ZERO);
        if (input.getInventoryPolicy() == null) input.setInventoryPolicy("continue");
        if (input.getInventoryQty() == null) input.setInventoryQty(1000);
        if (input.getRequiresShipping() == null) input.setRequiresShipping(true);
        if (input.getTaxable() == null) input.setTaxable(true);
        if (input.getWeightUnit() == null) input.setWeightUnit("g");
        if (input.getFulfillmentService() == null) input.setFulfillmentService("manual");
        mapper.insert(input);
        return input.getId();
    }

    /**
     * 普通字段更新（不含 SKU；改 SKU 走专用接口 + 二次确认）
     */
    @Transactional
    public void update(Long id, ProductVariant patch) {
        ProductVariant cur = mapper.selectById(id);
        if (cur == null) throw new BusinessException(ResultCode.NOT_FOUND);
        // 不允许通过此接口改 SKU
        patch.setSku(null);
        if (patch.getPosition() != null) cur.setPosition(patch.getPosition());
        if (patch.getOption1() != null) cur.setOption1(patch.getOption1());
        if (patch.getOption2() != null) cur.setOption2(patch.getOption2());
        if (patch.getOption3() != null) cur.setOption3(patch.getOption3());
        if (patch.getGrams() != null) cur.setGrams(patch.getGrams());
        if (patch.getWeightUnit() != null) cur.setWeightUnit(patch.getWeightUnit());
        if (patch.getInventoryQty() != null) cur.setInventoryQty(patch.getInventoryQty());
        if (patch.getInventoryPolicy() != null) cur.setInventoryPolicy(patch.getInventoryPolicy());
        if (patch.getPrice() != null) cur.setPrice(patch.getPrice());
        if (patch.getCompareAtPrice() != null) cur.setCompareAtPrice(patch.getCompareAtPrice());
        if (patch.getBarcode() != null) cur.setBarcode(patch.getBarcode());
        if (patch.getCostPerItem() != null) cur.setCostPerItem(patch.getCostPerItem());
        if (patch.getRequiresShipping() != null) cur.setRequiresShipping(patch.getRequiresShipping());
        if (patch.getTaxable() != null) cur.setTaxable(patch.getTaxable());
        if (patch.getTaxCode() != null) cur.setTaxCode(patch.getTaxCode());
        if (patch.getVariantImage() != null) cur.setVariantImage(patch.getVariantImage());
        mapper.updateById(cur);
    }

    @Transactional
    public void delete(Long id) {
        ProductVariant cur = mapper.selectById(id);
        if (cur == null) throw new BusinessException(ResultCode.NOT_FOUND);
        Long siblings = mapper.selectCount(new QueryWrapper<ProductVariant>()
            .eq("product_id", cur.getProductId()).ne("id", id));
        if (siblings == 0) {
            throw new BusinessException(ResultCode.CONFLICT, "至少保留一个变体");
        }
        mapper.deleteById(id);
    }
}
