package com.biou.shopifyhub.store;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 把店铺的 plan + 30d GMV/订单数刷新到 store 表，前端 list 直接读字段。
 *
 * <p>触发路径：
 * <ul>
 *   <li>定时（cron）：默认每天 03:30 全量刷一次 ACTIVE 店</li>
 *   <li>手动：StoreController#refreshMetrics 调本类 refreshOne</li>
 *   <li>接入新店：未来可在 connectCustomApp / SagaAuthService 落库后调用一次（本期未自动接，避免接入路径变重）</li>
 * </ul>
 *
 * <p>刷新流程（每店）：
 * <ol>
 *   <li>解密 token；token 缺失或解密失败 → 跳过（写日志，不动旧值）</li>
 *   <li>fetchShopDetail → 拿 plan_name 写 shopify_plan</li>
 *   <li>fetchOrders30dMetric → 拿 GMV / 订单数 / currency 写 metrics_*</li>
 *   <li>无论 plan / orders 哪一个失败，**只覆盖成功的那部分**，另一部分保留旧值</li>
 * </ol>
 *
 * <p>风险：orders.json 数据多时 30s+ 单店；按 ACTIVE 店逐个串行，避免 Shopify
 * REST 速率限制（标准 2 req/s / Plus 4 req/s）。如店铺过多需要 cron 跑很久，
 * 后续可改成多节点分片。
 */
@Service
public class StoreMetricsService {

    private static final Logger log = LoggerFactory.getLogger(StoreMetricsService.class);

    private final StoreMapper storeMapper;
    private final StoreService storeService;
    private final ShopifyApiClient shopify;

    public StoreMetricsService(StoreMapper storeMapper, StoreService storeService, ShopifyApiClient shopify) {
        this.storeMapper = storeMapper;
        this.storeService = storeService;
        this.shopify = shopify;
    }

    /** 每天 03:30（秒 分 时 日 月 周）全量刷新 ACTIVE 店；env SHOPIFY_METRICS_REFRESH_CRON 可覆盖。 */
    @Scheduled(cron = "${shopify.metrics.refresh-cron:0 30 3 * * *}")
    public void refreshAllScheduled() {
        log.info("[store-metrics] scheduled refresh starting");
        long ok = 0, fail = 0, skip = 0;
        List<Store> stores = storeMapper.selectList(
            new QueryWrapper<Store>().eq("status", "ACTIVE")
        );
        for (Store s : stores) {
            try {
                RefreshResult r = refreshOne(s);
                if (r == RefreshResult.SUCCESS) ok++;
                else if (r == RefreshResult.SKIPPED) skip++;
                else fail++;
            } catch (Exception e) {
                log.warn("[store-metrics] refresh failed storeId={} err={}", s.getId(), e.getMessage());
                fail++;
            }
        }
        log.info("[store-metrics] scheduled refresh done ok={} fail={} skip={} total={}",
            ok, fail, skip, stores.size());
    }

    /** 手动触发某店刷新。返回结果让 controller 反馈给前端。 */
    public RefreshResult refreshById(long storeId) {
        Store s = storeMapper.selectById(storeId);
        if (s == null) return RefreshResult.SKIPPED;
        return refreshOne(s);
    }

    private RefreshResult refreshOne(Store s) {
        String accessToken = decryptOrNull(s);
        if (accessToken == null) {
            log.debug("[store-metrics] skip storeId={} (no token / decrypt failed)", s.getId());
            return RefreshResult.SKIPPED;
        }

        boolean planUpdated = false, ordersUpdated = false;

        // 1) plan
        try {
            ShopifyApiClient.ShopDetail detail = shopify.fetchShopDetail(s.getMyshopifyDomain(), accessToken);
            if (detail.ok() && detail.planName() != null) {
                s.setShopifyPlan(detail.planName());
                planUpdated = true;
            } else {
                log.debug("[store-metrics] plan fetch failed storeId={} err={}", s.getId(), detail.error());
            }
        } catch (Exception e) {
            log.warn("[store-metrics] plan fetch threw storeId={} err={}", s.getId(), e.getMessage());
        }

        // 2) orders 30d
        try {
            ShopifyApiClient.OrdersMetric m = shopify.fetchOrders30dMetric(s.getMyshopifyDomain(), accessToken);
            if (m.ok()) {
                s.setGmv30d(m.gmv());
                s.setOrderCount30d(m.orderCount());
                s.setMetricsCurrency(m.currency());
                s.setMetricsFetchedAt(LocalDateTime.now());
                ordersUpdated = true;
            } else {
                log.debug("[store-metrics] orders fetch failed storeId={} err={}", s.getId(), m.error());
            }
        } catch (Exception e) {
            log.warn("[store-metrics] orders fetch threw storeId={} err={}", s.getId(), e.getMessage());
        }

        if (planUpdated || ordersUpdated) {
            storeMapper.updateById(s);
            return RefreshResult.SUCCESS;
        }
        return RefreshResult.FAILED;
    }

    private String decryptOrNull(Store s) {
        if (s.getEncryptedAccessToken() == null || s.getEncryptedAccessToken().isBlank()) return null;
        try {
            return storeService.decryptToken(s);
        } catch (Exception e) {
            return null;
        }
    }

    public enum RefreshResult { SUCCESS, FAILED, SKIPPED }
}
