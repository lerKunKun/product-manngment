package com.biou.shopifyhub.snapshot;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.snapshot.entity.ProductInventoryHistory;
import com.biou.shopifyhub.snapshot.entity.ProductPriceHistory;
import com.biou.shopifyhub.snapshot.mapper.ProductInventoryHistoryMapper;
import com.biou.shopifyhub.snapshot.mapper.ProductPriceHistoryMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Records price/inventory history rows from Shopify products/update|create webhooks (W2-SNAP-05).
 *
 * <p>For each variant in the payload, looks up the latest prior history row (by {@code changed_at})
 * for that {@code (store_id, variant_external_id)} pair and inserts a new row ONLY when the metric
 * value differs from that prior value. On the first ever webhook for a variant, {@code old_price} /
 * {@code old_quantity} are written as NULL.
 *
 * <p>Currency is hardcoded to {@code USD} (TODO: read from store config in W3-PUR).
 *
 * <p>All failures must be swallowed by the caller — webhook delivery should always 200 to Shopify.
 */
@Service
public class PriceInventoryHistoryService {

    private static final Logger log = LoggerFactory.getLogger(PriceInventoryHistoryService.class);

    private final ProductPriceHistoryMapper priceMapper;
    private final ProductInventoryHistoryMapper inventoryMapper;

    public PriceInventoryHistoryService(ProductPriceHistoryMapper priceMapper,
                                        ProductInventoryHistoryMapper inventoryMapper) {
        this.priceMapper = priceMapper;
        this.inventoryMapper = inventoryMapper;
    }

    /**
     * Process webhook variants: for each variant, emit history rows where the value differs
     * from the latest prior row. Returns count of price + inventory rows inserted.
     */
    public Stats record(long tenantId, long storeId, String productExternalId,
                        List<Map<String, Object>> variants, String topic) {
        if (variants == null || variants.isEmpty()) {
            return new Stats(0, 0);
        }
        int priceInserts = 0;
        int inventoryInserts = 0;
        for (Map<String, Object> v : variants) {
            if (v == null) continue;
            Object idVal = v.get("id");
            if (idVal == null) continue;
            String variantExternalId = String.valueOf(idVal);
            if (variantExternalId.isEmpty() || "null".equals(variantExternalId)) continue;

            // PRICE
            BigDecimal newPrice = parseDec(v.get("price"));
            BigDecimal newCompare = parseDec(v.get("compare_at_price"));
            if (newPrice != null) {
                ProductPriceHistory last = priceMapper.selectOne(new QueryWrapper<ProductPriceHistory>()
                    .eq("store_id", storeId)
                    .eq("variant_external_id", variantExternalId)
                    .orderByDesc("changed_at")
                    .last("LIMIT 1"));
                BigDecimal oldP = last != null ? last.getPrice() : null;
                BigDecimal oldCompare = last != null ? last.getCompareAtPrice() : null;
                if (oldP == null
                    || newPrice.compareTo(oldP) != 0
                    || !equalsDec(newCompare, oldCompare)) {
                    ProductPriceHistory row = new ProductPriceHistory();
                    row.setTenantId(tenantId);
                    row.setStoreId(storeId);
                    row.setProductExternalId(productExternalId);
                    row.setVariantExternalId(variantExternalId);
                    row.setPrice(newPrice);
                    row.setCompareAtPrice(newCompare);
                    row.setOldPrice(oldP);
                    // TODO(W3-PUR): read currency from store config; Shopify variant payload has no currency field.
                    row.setCurrency("USD");
                    row.setChangedAt(LocalDateTime.now());
                    row.setSource("WEBHOOK");
                    priceMapper.insert(row);
                    priceInserts++;
                }
            }

            // INVENTORY
            Integer newQty = parseInt(v.get("inventory_quantity"));
            if (newQty != null) {
                ProductInventoryHistory last = inventoryMapper.selectOne(new QueryWrapper<ProductInventoryHistory>()
                    .eq("store_id", storeId)
                    .eq("variant_external_id", variantExternalId)
                    .orderByDesc("changed_at")
                    .last("LIMIT 1"));
                Integer oldQ = last != null ? last.getInventoryQuantity() : null;
                if (oldQ == null || !newQty.equals(oldQ)) {
                    ProductInventoryHistory row = new ProductInventoryHistory();
                    row.setTenantId(tenantId);
                    row.setStoreId(storeId);
                    row.setProductExternalId(productExternalId);
                    row.setVariantExternalId(variantExternalId);
                    row.setInventoryQuantity(newQty);
                    row.setOldQuantity(oldQ);
                    row.setChangedAt(LocalDateTime.now());
                    row.setSource("WEBHOOK");
                    inventoryMapper.insert(row);
                    inventoryInserts++;
                }
            }
        }
        if (priceInserts > 0 || inventoryInserts > 0) {
            log.debug("[history] topic={} store={} product={} priceInserts={} inventoryInserts={}",
                topic, storeId, productExternalId, priceInserts, inventoryInserts);
        }
        return new Stats(priceInserts, inventoryInserts);
    }

    public record Stats(int priceInserts, int inventoryInserts) {}

    private static BigDecimal parseDec(Object v) {
        if (v == null) return null;
        if (v instanceof BigDecimal bd) return bd;
        if (v instanceof Number n) return BigDecimal.valueOf(n.doubleValue());
        try {
            String s = String.valueOf(v).trim();
            if (s.isEmpty() || "null".equals(s)) return null;
            return new BigDecimal(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static Integer parseInt(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.intValue();
        try {
            String s = String.valueOf(v).trim();
            if (s.isEmpty() || "null".equals(s)) return null;
            return Integer.parseInt(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean equalsDec(BigDecimal a, BigDecimal b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        return a.compareTo(b) == 0;
    }
}
