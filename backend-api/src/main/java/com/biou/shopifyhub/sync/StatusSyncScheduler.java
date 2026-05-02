package com.biou.shopifyhub.sync;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Day-7 W2-SYNC-02 — 04:00 全店全产品兜底扫.
 *
 * <p>Iterates all {@code ACTIVE} stores and asks {@link StatusSyncService} to reconcile
 * each. Per-store failures are caught + logged; the scheduler thread never crashes.
 *
 * <p>Cron defaults to {@code 0 0 4 * * *} (every day at 04:00 local time). Override via
 * {@code SHOPIFY_SYNC_FULL_CRON} env / {@code shopify.sync.full-cron} property.
 *
 * <p>The actual Shopify reconciliation is currently a skeleton (see
 * {@link StatusSyncService}); this scheduler is wired up so the cron registration is
 * verifiable end-to-end at Day 7.
 */
@Component
public class StatusSyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(StatusSyncScheduler.class);

    private final StoreMapper storeMapper;
    private final StatusSyncService syncService;

    public StatusSyncScheduler(StoreMapper storeMapper, StatusSyncService syncService) {
        this.storeMapper = storeMapper;
        this.syncService = syncService;
    }

    /**
     * 每天 04:00 全量兜底扫：检查所有 ACTIVE store 的 store_product 行，
     * 对照 Shopify 修正状态。所有异常 swallow + 写日志，不让调度线程崩。
     */
    @Scheduled(cron = "${shopify.sync.full-cron:0 0 4 * * *}")
    public void runFullSync() {
        long startMs = System.currentTimeMillis();
        try {
            List<Store> stores = storeMapper.selectList(
                new QueryWrapper<Store>().eq("status", "ACTIVE"));
            int totalStores = 0, totalProducts = 0, errors = 0;
            for (Store s : stores) {
                totalStores++;
                try {
                    int n = syncService.syncStore(s);
                    totalProducts += n;
                } catch (Exception e) {
                    errors++;
                    log.error("[sync] store sync failed id={} domain={} err={}",
                        s.getId(), s.getMyshopifyDomain(), e.getMessage(), e);
                }
            }
            log.info("[sync] full status sync done: stores={} products={} errors={} elapsedMs={}",
                totalStores, totalProducts, errors, System.currentTimeMillis() - startMs);
        } catch (Exception e) {
            // top-level catch — must not let scheduler thread crash.
            log.error("[sync] full sync top-level failed: {}", e.getMessage(), e);
        }
    }
}
