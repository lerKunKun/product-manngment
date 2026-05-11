package com.biou.shopifyhub.purchase;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.product.entity.ProductVariant;
import com.biou.shopifyhub.product.mapper.ProductVariantMapper;
import com.biou.shopifyhub.purchase.entity.PurchaseInfo;
import com.biou.shopifyhub.purchase.entity.SkuChangeLog;
import com.biou.shopifyhub.purchase.mapper.PurchaseInfoMapper;
import com.biou.shopifyhub.purchase.mapper.SkuChangeLogMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class PurchaseController {

    private static final Logger log = LoggerFactory.getLogger(PurchaseController.class);

    private final PurchaseInfoMapper purchaseMapper;
    private final SkuChangeLogMapper skuLogMapper;
    private final ProductVariantMapper variantMapper;

    public PurchaseController(
        PurchaseInfoMapper purchaseMapper,
        SkuChangeLogMapper skuLogMapper,
        ProductVariantMapper variantMapper
    ) {
        this.purchaseMapper = purchaseMapper;
        this.skuLogMapper = skuLogMapper;
        this.variantMapper = variantMapper;
    }

    /** 查询某产品下所有变体的采购信息（按变体 join） */
    @GetMapping("/product/{productId}/purchase")
    @PreAuthorize("hasAuthority('PERM_PURCHASE:READ')")
    public Result<List<Map<String, Object>>> listByProduct(@PathVariable Long productId) {
        List<ProductVariant> variants = variantMapper.selectList(
            new QueryWrapper<ProductVariant>().eq("product_id", productId).orderByAsc("position"));
        List<Map<String, Object>> rows = new java.util.ArrayList<>();
        for (ProductVariant v : variants) {
            PurchaseInfo info = purchaseMapper.selectOne(
                new QueryWrapper<PurchaseInfo>().eq("variant_id", v.getId()));
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("variantId", v.getId());
            row.put("position", v.getPosition());
            row.put("sku", v.getSku());
            row.put("option1", v.getOption1());
            row.put("option2", v.getOption2());
            row.put("price", v.getPrice());
            if (info != null) {
                row.put("purchaseUrl", info.getPurchaseUrl());
                row.put("cost", info.getCost());
                row.put("currency", info.getCurrency());
                row.put("grossWeight", info.getGrossWeight());
                row.put("weightUnit", info.getWeightUnit());
                row.put("logisticsTags", info.getLogisticsTags());
                row.put("note", info.getNote());
            } else {
                row.put("purchaseUrl", null);
                row.put("cost", null);
            }
            rows.add(row);
        }
        return Result.ok(rows);
    }

    /** Upsert 变体的采购信息 */
    @PutMapping("/variant/{variantId}/purchase")
    @PreAuthorize("hasAuthority('PERM_PURCHASE:SKU_EDIT')")
    public Result<Void> upsert(@PathVariable Long variantId, @RequestBody PurchaseInfo input) {
        ProductVariant v = variantMapper.selectById(variantId);
        if (v == null) throw new BusinessException(ResultCode.NOT_FOUND, "变体不存在");

        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;

        PurchaseInfo cur = purchaseMapper.selectOne(
            new QueryWrapper<PurchaseInfo>().eq("variant_id", variantId));
        if (cur == null) {
            input.setVariantId(variantId);
            input.setProductId(v.getProductId());
            input.setUpdatedBy(uid);
            if (input.getCurrency() == null) input.setCurrency("CNY");
            if (input.getWeightUnit() == null) input.setWeightUnit("g");
            purchaseMapper.insert(input);
        } else {
            if (input.getPurchaseUrl() != null) cur.setPurchaseUrl(input.getPurchaseUrl());
            if (input.getCost() != null) cur.setCost(input.getCost());
            if (input.getCurrency() != null) cur.setCurrency(input.getCurrency());
            if (input.getGrossWeight() != null) cur.setGrossWeight(input.getGrossWeight());
            if (input.getWeightUnit() != null) cur.setWeightUnit(input.getWeightUnit());
            if (input.getLogisticsTags() != null) cur.setLogisticsTags(input.getLogisticsTags());
            if (input.getNote() != null) cur.setNote(input.getNote());
            cur.setUpdatedBy(uid);
            purchaseMapper.updateById(cur);
        }
        return Result.ok();
    }

    /**
     * 改 SKU 是危险操作：走 @RequireSensitiveOp + 落 sku_change_log。
     * Wave 1 简化：仅改本地 product_variant.sku；推送到所有映射店铺留 W2。
     */
    @RequireSensitiveOp("PURCHASE_SKU_EDIT")
    @PreAuthorize("hasAuthority('PERM_PURCHASE:SKU_EDIT')")
    @PostMapping("/variant/{variantId}/sku")
    @Transactional
    public Result<Map<String, Long>> changeSku(
        @PathVariable Long variantId,
        @RequestBody ChangeSkuReq req
    ) {
        ProductVariant v = variantMapper.selectById(variantId);
        if (v == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (req.newSku == null || req.newSku.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "newSku 必填");
        }
        if (req.newSku.equals(v.getSku())) {
            throw new BusinessException(ResultCode.BUSINESS_ERROR, "新 SKU 与当前相同");
        }

        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;

        SkuChangeLog logRow = new SkuChangeLog();
        logRow.setVariantId(variantId);
        logRow.setProductId(v.getProductId());
        logRow.setOldSku(v.getSku());
        logRow.setNewSku(req.newSku);
        logRow.setChangedBy(uid);
        logRow.setConfirmedAt(LocalDateTime.now());
        logRow.setSyncStatus("PENDING");  // W2 推送到 store 后改为 SUCCESS/PARTIAL/FAILED
        skuLogMapper.insert(logRow);

        v.setSku(req.newSku);
        variantMapper.updateById(v);

        log.info("[sku-change] variantId={} {} -> {} by={}", variantId, logRow.getOldSku(), req.newSku, uid);
        return Result.ok(Map.of("logId", logRow.getId()));
    }

    @GetMapping("/variant/{variantId}/sku-log")
    @PreAuthorize("hasAuthority('PERM_PURCHASE:READ')")
    public Result<List<SkuChangeLog>> listLog(@PathVariable Long variantId) {
        return Result.ok(skuLogMapper.selectList(
            new QueryWrapper<SkuChangeLog>().eq("variant_id", variantId).orderByDesc("confirmed_at")));
    }

    public static class ChangeSkuReq {
        public String newSku;
    }
}
