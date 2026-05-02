package com.biou.shopifyhub.push;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.push.entity.StoreProduct;
import com.biou.shopifyhub.push.mapper.StoreProductMapper;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Read-only aggregator for the "店铺映射" tab on product detail (W2-SYNC-04).
 *
 * <p>Returns the per-store push status for a given product: each row is one
 * {@code store_product} joined with the originating {@code store} so the UI
 * can render store brand/domain/status alongside the mapping's lifecycle
 * (status, shopify ids, last_pushed_at, last_pulled_at).
 *
 * <p>Non-blocking: when a product has zero mappings the endpoint returns an
 * empty list (the frontend renders an EmptyState).
 */
@RestController
@RequestMapping("/product")
public class ProductStoreMappingController {

    private static final Logger log = LoggerFactory.getLogger(ProductStoreMappingController.class);

    private final StoreProductMapper storeProductMapper;
    private final StoreMapper storeMapper;

    public ProductStoreMappingController(StoreProductMapper storeProductMapper, StoreMapper storeMapper) {
        this.storeProductMapper = storeProductMapper;
        this.storeMapper = storeMapper;
    }

    @GetMapping("/{id}/store-products")
    public Result<List<Map<String, Object>>> list(@PathVariable("id") Long productId) {
        List<StoreProduct> rows = storeProductMapper.selectList(
            new LambdaQueryWrapper<StoreProduct>()
                .eq(StoreProduct::getProductId, productId)
                .orderByDesc(StoreProduct::getUpdatedAt)
        );
        if (rows.isEmpty()) {
            return Result.ok(Collections.emptyList());
        }

        Set<Long> storeIds = rows.stream().map(StoreProduct::getStoreId).collect(Collectors.toSet());
        List<Store> stores = storeMapper.selectBatchIds(storeIds);
        Map<Long, Store> storeMap = stores.stream().collect(Collectors.toMap(Store::getId, s -> s));

        List<Map<String, Object>> result = new ArrayList<>(rows.size());
        for (StoreProduct sp : rows) {
            Store s = storeMap.get(sp.getStoreId());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", sp.getId());
            row.put("storeId", sp.getStoreId());
            row.put("storeBrand", s != null ? s.getBrandName() : null);
            row.put("storeDomain", s != null ? s.getMyshopifyDomain() : null);
            row.put("storeStatus", s != null ? s.getStatus() : null);
            row.put("status", sp.getStatus());
            row.put("shopifyProductId", sp.getShopifyProductId());
            row.put("shopifyHandle", sp.getShopifyHandle());
            row.put("lastPushTaskId", sp.getLastPushTaskId());
            row.put("lastPushedAt", sp.getLastPushedAt());
            row.put("lastPulledAt", sp.getLastPulledAt());
            row.put("createdAt", sp.getCreatedAt());
            row.put("updatedAt", sp.getUpdatedAt());
            result.add(row);
        }
        log.debug("listed {} store-product mappings for product {}", result.size(), productId);
        return Result.ok(result);
    }
}
