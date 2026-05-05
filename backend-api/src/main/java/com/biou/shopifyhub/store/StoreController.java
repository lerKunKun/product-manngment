package com.biou.shopifyhub.store;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.push.entity.StoreProduct;
import com.biou.shopifyhub.push.mapper.StoreProductMapper;
import com.biou.shopifyhub.store.entity.Store;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/store")
public class StoreController {

    private static final Logger log = LoggerFactory.getLogger(StoreController.class);

    private final StoreService service;
    private final ShopifyApiClient shopify;
    private final StoreProductMapper storeProductMapper;
    private final StoreMetricsService metricsService;
    private final ObjectMapper objectMapper;

    public StoreController(StoreService service, ShopifyApiClient shopify,
                           StoreProductMapper storeProductMapper,
                           StoreMetricsService metricsService,
                           ObjectMapper objectMapper) {
        this.service = service;
        this.shopify = shopify;
        this.storeProductMapper = storeProductMapper;
        this.metricsService = metricsService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('PERM_STORE:READ')")
    public Result<List<Map<String, Object>>> list(
            @RequestParam(required = false) Long tenantId,
            @RequestParam(required = false) Boolean partnerCollab,
            @RequestParam(required = false) Boolean devStore) {
        List<Store> stores = service.list(tenantId, partnerCollab, devStore);

        // 一次 GROUP BY 查所有 store 的活跃产品数，避免 N+1
        Map<Long, Long> productCountByStore = new HashMap<>();
        if (!stores.isEmpty()) {
            List<Long> storeIds = stores.stream().map(Store::getId).toList();
            // 注意：MyBatis-Plus QueryWrapper.select(String...) 多参版本会给每个参数
            // 加反引号 → 把 COUNT(*) AS cnt 包成 `COUNT(*) AS cnt` 撞 SQL 语法错。
            // 改用单字符串 select(String) 透传不加引号；同时 COUNT(*) → COUNT(id) 双保险
            List<Map<String, Object>> rows = storeProductMapper.selectMaps(
                new QueryWrapper<StoreProduct>()
                    .select("store_id, COUNT(id) AS cnt")
                    .in("store_id", storeIds)
                    .eq("status", "ACTIVE")
                    .groupBy("store_id")
            );
            for (Map<String, Object> r : rows) {
                Object sid = r.get("store_id");
                Object cnt = r.get("cnt");
                if (sid instanceof Number && cnt instanceof Number) {
                    productCountByStore.put(((Number) sid).longValue(), ((Number) cnt).longValue());
                }
            }
        }

        List<Map<String, Object>> dto = stores.stream().map(s -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", s.getId());
            m.put("myshopifyDomain", s.getMyshopifyDomain());
            m.put("customDomain", s.getCustomDomain());
            m.put("brandName", s.getBrandName());
            m.put("tokenType", s.getTokenType());
            m.put("status", s.getStatus());
            m.put("expiresAt", s.getExpiresAt());
            m.put("isDevStore", s.getIsDevStore());
            m.put("isPartnerCollab", s.getIsPartnerCollab());
            m.put("createdAt", s.getCreatedAt());
            // 卡片版 UI 需要：已上架活跃产品数
            m.put("productCount", productCountByStore.getOrDefault(s.getId(), 0L));
            // V31/V32：plan + 5 时间窗 GMV/订单数（today/week/month/year/ytd）
            m.put("shopifyPlan", s.getShopifyPlan());
            m.put("metricsCurrency", s.getMetricsCurrency());
            m.put("metricsFetchedAt", s.getMetricsFetchedAt());
            // metrics_periods 列存 JSON：解析成对象返给前端，避免前端二次解析
            if (s.getMetricsPeriods() != null && !s.getMetricsPeriods().isBlank()) {
                try {
                    m.put("metricsPeriods", objectMapper.readValue(
                        s.getMetricsPeriods(), new TypeReference<Map<String, Object>>() {}));
                } catch (Exception e) {
                    m.put("metricsPeriods", null);
                }
            } else {
                m.put("metricsPeriods", null);
            }
            return m;
        }).toList();
        return Result.ok(dto);
    }

    @PostMapping("/connect/custom-app")
    @PreAuthorize("hasAuthority('PERM_STORE:OAUTH')")
    public Result<Map<String, Long>> connectCustomApp(@RequestBody StoreService.ConnectCustomAppReq req) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        Long id = service.connectCustomApp(req, uid);
        return Result.ok(Map.of("storeId", id));
    }

    /** 手动触发店铺指标刷新（plan + 30d GMV/订单数）。同步调用，订单多时可能 30s+。 */
    @PostMapping("/{id}/refresh-metrics")
    @PreAuthorize("hasAuthority('PERM_STORE:READ')")
    public Result<Map<String, Object>> refreshMetrics(@PathVariable Long id) {
        StoreMetricsService.RefreshResult r = metricsService.refreshById(id);
        return Result.ok(Map.of("storeId", id, "result", r.name()));
    }

    /** 删除店铺是危险操作 */
    @RequireSensitiveOp("STORE_DELETE")
    @PreAuthorize("hasAuthority('PERM_STORE:TOKEN_MANAGE')")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.delete(id, uid);
        return Result.ok();
    }

    /** W3-PV-01：把店铺打入合作者店铺池 */
    @RequireSensitiveOp("STORE_MARK_PARTNER_COLLAB")
    @PreAuthorize("hasAuthority('PERM_STORE:TOKEN_MANAGE')")
    @PostMapping("/{id}/mark-partner-collab")
    public Result<Void> markPartnerCollab(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.setPartnerCollab(id, true, uid);
        return Result.ok();
    }

    /** W3-PV-01：把店铺移出合作者店铺池 */
    @RequireSensitiveOp("STORE_MARK_PARTNER_COLLAB")
    @PreAuthorize("hasAuthority('PERM_STORE:TOKEN_MANAGE')")
    @PostMapping("/{id}/unmark-partner-collab")
    public Result<Void> unmarkPartnerCollab(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.setPartnerCollab(id, false, uid);
        return Result.ok();
    }

    /** W3-PV-01：标记店铺为 dev store（影响计费 / 试用规则） */
    @RequireSensitiveOp("STORE_MARK_DEV_STORE")
    @PreAuthorize("hasAuthority('PERM_STORE:TOKEN_MANAGE')")
    @PostMapping("/{id}/mark-dev-store")
    public Result<Void> markDevStore(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.setDevStore(id, true, uid);
        return Result.ok();
    }

    /** T10: 禁用店铺（status=DISABLED，对齐既有枚举集 ACTIVE/DISABLED/TOKEN_EXPIRED/UNINSTALLED）。敏感操作。 */
    @RequireSensitiveOp("STORE_BATCH_DISABLE")
    @PreAuthorize("hasAuthority('PERM_STORE:TOKEN_MANAGE')")
    @PostMapping("/{id}/disable")
    public Result<Void> disable(@PathVariable Long id) {
        Store s = service.getById(id);
        s.setStatus("DISABLED");
        service.updateStatus(s);
        return Result.ok();
    }

    /**
     * T22: 真调 Shopify shop.json 健康检查。
     * 直调路径：backend-api → Shopify Admin API（未走 worker，因当前 worker 未提供 /test/store endpoint）。
     * 任何异常 → healthy=false + reason，不抛 500。
     */
    @GetMapping("/{id}/test")
    @PreAuthorize("hasAuthority('PERM_STORE:READ')")
    public Result<Map<String, Object>> test(@PathVariable Long id) {
        Store s = service.getById(id);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("storeId", s.getId());
        resp.put("status", s.getStatus());
        boolean tokenPresent = s.getEncryptedAccessToken() != null && !s.getEncryptedAccessToken().isBlank();
        resp.put("tokenPresent", tokenPresent);
        if (!tokenPresent) {
            resp.put("healthy", false);
            resp.put("reason", "店铺无 access_token，无法验证");
            return Result.ok(resp);
        }
        String token;
        try {
            token = service.decryptToken(s);
        } catch (Exception e) {
            log.warn("[store-test] decrypt token failed id={} err={}", id, e.getMessage());
            resp.put("healthy", false);
            resp.put("reason", "Token 解密失败：" + e.getMessage());
            return Result.ok(resp);
        }
        ShopifyApiClient.ShopDetail detail = shopify.fetchShopDetail(s.getMyshopifyDomain(), token);
        if (!detail.ok()) {
            resp.put("healthy", false);
            resp.put("reason", detail.error());
            return Result.ok(resp);
        }
        resp.put("healthy", true);
        resp.put("shopName", detail.name());
        resp.put("planName", detail.planName());
        return Result.ok(resp);
    }
}
