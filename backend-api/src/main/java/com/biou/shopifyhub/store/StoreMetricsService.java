package com.biou.shopifyhub.store;

import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 把店铺的 plan + 5 时间窗 GMV/订单数刷到 store 表。
 *
 * <p>触发：手动（StoreController#refreshMetrics）+ 前端进店铺管理页 mount 时
 * 批量调一次（避免 cron 一直空转）。本 service 不带定时任务。
 *
 * <p>刷新流程（每店）：
 * <ol>
 *   <li>解密 token；token 缺失 → SKIPPED</li>
 *   <li>fetchShopDetail → plan_name 写 shopify_plan</li>
 *   <li>fetchOrdersBucketed → 5 桶 (today/week/month/year/ytd) + currency
 *       → 序列化成 JSON 写 metrics_periods 列；同时写 metrics_currency 和 metrics_fetched_at</li>
 *   <li>plan / orders 任一成功就 update 该字段；都失败 → FAILED 不动旧值</li>
 * </ol>
 *
 * <p>风险：fetchOrdersBucketed 单次拉至多 365d 订单（最多 20 页 = 5000 单），
 * 大店可能 30s+。串行调用避免速率限制。
 */
@Service
public class StoreMetricsService {

    private static final Logger log = LoggerFactory.getLogger(StoreMetricsService.class);

    private final StoreMapper storeMapper;
    private final StoreService storeService;
    private final ShopifyApiClient shopify;
    private final ObjectMapper mapper;

    public StoreMetricsService(StoreMapper storeMapper, StoreService storeService,
                               ShopifyApiClient shopify, ObjectMapper mapper) {
        this.storeMapper = storeMapper;
        this.storeService = storeService;
        this.shopify = shopify;
        this.mapper = mapper;
    }

    /** 手动触发某店刷新。 */
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

        // 2) orders 5 桶
        try {
            ShopifyApiClient.OrdersBundle b = shopify.fetchOrdersBucketed(s.getMyshopifyDomain(), accessToken);
            if (b.ok()) {
                Map<String, Object> periods = new LinkedHashMap<>();
                periods.put("today", bucketJson(b.today()));
                periods.put("week", bucketJson(b.week()));
                periods.put("month", bucketJson(b.month()));
                periods.put("year", bucketJson(b.year()));
                periods.put("ytd", bucketJson(b.ytd()));
                periods.put("currency", b.currency());
                s.setMetricsPeriods(mapper.writeValueAsString(periods));
                s.setMetricsCurrency(b.currency());
                s.setMetricsFetchedAt(LocalDateTime.now());
                // 兼容 V31 字段：30d 当成 month 桶值塞回（某些旧 caller 仍读这俩）
                s.setGmv30d(b.month().gmv);
                s.setOrderCount30d(b.month().orders);
                ordersUpdated = true;
            } else {
                log.debug("[store-metrics] orders fetch failed storeId={} err={}", s.getId(), b.error());
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

    private static Map<String, Object> bucketJson(ShopifyApiClient.Bucket b) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("gmv", b.gmv);
        m.put("orders", b.orders);
        return m;
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
