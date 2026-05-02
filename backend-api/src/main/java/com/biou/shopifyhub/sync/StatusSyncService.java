package com.biou.shopifyhub.sync;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.push.entity.StoreProduct;
import com.biou.shopifyhub.push.mapper.StoreProductMapper;
import com.biou.shopifyhub.store.entity.Store;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Day-7 W2-SYNC-02 — Multi-store product status sync.
 *
 * <p>Skeleton only: enumerates locally-mapped {@code store_product} rows for a given store
 * and logs the count that <em>would</em> be reconciled against live Shopify data.
 *
 * <p>Real reconciliation (Shopify Admin GraphQL pagination + bulk operations + drift detection
 * on each row) is W3 territory because it requires a new worker endpoint
 * (e.g. {@code POST /sync/store-products}) that we do not own at Day 7.
 *
 * <p>Marked with {@code TODO(W3)} below — flip from skeleton to real call once worker exposes it.
 */
@Service
public class StatusSyncService {

    private static final Logger log = LoggerFactory.getLogger(StatusSyncService.class);

    private final StoreProductMapper storeProductMapper;

    public StatusSyncService(StoreProductMapper storeProductMapper) {
        this.storeProductMapper = storeProductMapper;
    }

    /**
     * Walk locally-mapped products for a store and (eventually) verify each against Shopify.
     *
     * <p>Day 7: log skeleton only. Returns count of mapped products considered.
     *
     * @param store target store (must be ACTIVE — caller filters)
     * @return number of {@code store_product} rows examined
     */
    public int syncStore(Store store) {
        if (store == null || store.getId() == null) {
            return 0;
        }
        List<StoreProduct> mapped;
        try {
            mapped = storeProductMapper.selectList(new QueryWrapper<StoreProduct>()
                .eq("store_id", store.getId())
                .ne("status", "NOT_PUSHED"));
        } catch (Exception e) {
            log.error("[sync] store_product fetch failed store={} domain={}: {}",
                store.getId(), store.getMyshopifyDomain(), e.getMessage(), e);
            return 0;
        }

        // TODO(W3): call worker `POST /sync/store-products` (future) to fetch live status
        // for each row, compare and update local store_product.status if drift detected.
        // For Day 7: log skeleton only — no Shopify calls, no DB writes.
        log.info("[sync][skeleton] would sync store={} domain={} mapped_products={}",
            store.getId(), store.getMyshopifyDomain(), mapped.size());

        return mapped.size();
    }
}
