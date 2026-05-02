package com.biou.shopifyhub.product.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.push.PushService;
import com.biou.shopifyhub.push.entity.StoreProduct;
import com.biou.shopifyhub.push.mapper.StoreProductMapper;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Fan-out a local product status flip to every Shopify store the product has
 * already been pushed to (W2-SYNC-03 "produce status broadcast").
 *
 * <p>Triggered by {@link ProductService#update} after the local row commits.
 * Skipped store_product rows: {@code NOT_PUSHED} (never pushed, nothing to
 * mirror) and {@code FAILED} (last push errored, retry should be a manual
 * decision). Stores in {@code Store.status='UNINSTALLED'} are also skipped.
 *
 * <p>Sync best-effort: each per-store {@link PushService#push} is wrapped in
 * its own try/catch so a slow / failing store does not abort the loop. The
 * caller in {@code ProductService.update} additionally swallows any throw
 * from this method to honour the "product update must not 500 because of
 * push" non-blocking constraint.
 *
 * <p>TODO (W3+): move the per-store push loop off the request thread (e.g.
 * dedicated {@code @Async} bean to avoid the self-injection trap), so large
 * fan-out doesn't block the HTTP response. Same limitation as
 * {@code PushService.pushBatch} — see Wave2-配置占位.md §15.
 */
@Service
public class ProductStatusBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(ProductStatusBroadcaster.class);

    private final StoreProductMapper storeProductMapper;
    private final StoreMapper storeMapper;
    private final PushService pushService;

    public ProductStatusBroadcaster(StoreProductMapper storeProductMapper,
                                    StoreMapper storeMapper,
                                    PushService pushService) {
        this.storeProductMapper = storeProductMapper;
        this.storeMapper = storeMapper;
        this.pushService = pushService;
    }

    /**
     * For a product whose local status flipped, push to every store the
     * product has been mapped to (excluding NOT_PUSHED, FAILED, and stores
     * marked UNINSTALLED).
     */
    public BroadcastResult broadcastStatusChange(long productId, String oldStatus, String newStatus) {
        if (oldStatus == null || newStatus == null || oldStatus.equals(newStatus)) {
            return new BroadcastResult(0, 0, 0);
        }

        List<StoreProduct> mappings = storeProductMapper.selectList(
            new LambdaQueryWrapper<StoreProduct>()
                .eq(StoreProduct::getProductId, productId)
                .notIn(StoreProduct::getStatus, List.of("NOT_PUSHED", "FAILED"))
        );
        if (mappings.isEmpty()) {
            log.debug("[broadcast] productId={} no mapped stores; status {} -> {} no fan-out",
                productId, oldStatus, newStatus);
            return new BroadcastResult(0, 0, 0);
        }

        Set<Long> storeIds = new LinkedHashSet<>();
        for (StoreProduct sp : mappings) storeIds.add(sp.getStoreId());
        List<Store> stores = storeMapper.selectBatchIds(storeIds);
        Set<Long> activeStoreIds = stores.stream()
            .filter(s -> !"UNINSTALLED".equals(s.getStatus()))
            .map(Store::getId)
            .collect(Collectors.toSet());

        int pushed = 0, skipped = 0, failed = 0;
        for (StoreProduct sp : mappings) {
            if (!activeStoreIds.contains(sp.getStoreId())) {
                skipped++;
                log.info("[broadcast] skip uninstalled store storeId={} productId={}",
                    sp.getStoreId(), productId);
                continue;
            }
            try {
                // triggeredBy=null = system fan-out (audit shows no user)
                pushService.push(productId, sp.getStoreId(), null);
                pushed++;
            } catch (Exception e) {
                failed++;
                log.warn("[broadcast] push failed storeId={} productId={} err={}",
                    sp.getStoreId(), productId, e.getMessage());
            }
        }
        log.info("[broadcast] productId={} status {} -> {} pushed={} skipped={} failed={}",
            productId, oldStatus, newStatus, pushed, skipped, failed);
        return new BroadcastResult(pushed, skipped, failed);
    }

    public record BroadcastResult(int pushed, int skipped, int failed) {}
}
