package com.biou.shopifyhub.store;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Shopify Admin API 简易客户端。
 * Wave 1：仅支持 shop.json 验证 token + token exchange；
 * Wave 2 加 GraphQL 客户端、产品/主题等。
 */
@Component
public class ShopifyApiClient {

    private static final Logger log = LoggerFactory.getLogger(ShopifyApiClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(8))
        .build();

    @Value("${SHOPIFY_API_VERSION:2024-10}")
    private String apiVersion;

    /** T37: 注入 base URL 前缀（默认 https://），test profile 用 http:// 让 WireMock 拦截。 */
    @Value("${shopify.api-base-url:https://}")
    private String apiBaseUrl;

    /** 调 /admin/api/{ver}/shop.json 验证 token 是否有效 + 返回 shop 基本信息。 */
    public ShopInfo verifyToken(String myshopifyDomain, String accessToken) {
        try {
            String url = apiBaseUrl + myshopifyDomain + "/admin/api/" + apiVersion + "/shop.json";
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .header("X-Shopify-Access-Token", accessToken)
                .timeout(Duration.ofSeconds(10))
                .GET().build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 401 || resp.statusCode() == 403) {
                return new ShopInfo(false, null, "Token 被拒（HTTP " + resp.statusCode() + "）");
            }
            if (resp.statusCode() != 200) {
                return new ShopInfo(false, null, "HTTP " + resp.statusCode() + ": " + snip(resp.body(), 200));
            }
            JsonNode shop = JSON.readTree(resp.body()).path("shop");
            return new ShopInfo(true, shop.path("name").asText(null), null);
        } catch (Exception e) {
            log.error("Shopify verifyToken error domain={}", myshopifyDomain, e);
            return new ShopInfo(false, null, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /**
     * T22: 调 shop.json 拿完整 shop 信息（name + plan_name 等）用于健康检查。
     * 区别于 verifyToken：返回 plan_name；超时更短（8s）。
     */
    public ShopDetail fetchShopDetail(String myshopifyDomain, String accessToken) {
        try {
            String url = apiBaseUrl + myshopifyDomain + "/admin/api/" + apiVersion + "/shop.json";
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .header("X-Shopify-Access-Token", accessToken)
                .timeout(Duration.ofSeconds(8))
                .GET().build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                return new ShopDetail(false, resp.statusCode(), null, null, "Shopify HTTP " + resp.statusCode());
            }
            JsonNode shop = JSON.readTree(resp.body()).path("shop");
            return new ShopDetail(true, 200,
                shop.path("name").asText(null),
                shop.path("plan_name").asText(null),
                null);
        } catch (Exception e) {
            log.warn("Shopify fetchShopDetail error domain={} err={}", myshopifyDomain, e.getMessage());
            return new ShopDetail(false, 0, null, null,
                e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** OAuth code → access_token */
    public TokenExchangeResult exchangeCode(String shop, String code, String apiKey, String apiSecret) {
        try {
            String url = apiBaseUrl + shop + "/admin/oauth/access_token";
            String body = String.format(
                "{\"client_id\":\"%s\",\"client_secret\":\"%s\",\"code\":\"%s\"}",
                apiKey, apiSecret, code
            );
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                return new TokenExchangeResult(false, null, null, "HTTP " + resp.statusCode() + ": " + snip(resp.body(), 200));
            }
            JsonNode n = JSON.readTree(resp.body());
            String accessToken = n.path("access_token").asText(null);
            String scope = n.path("scope").asText(null);
            return new TokenExchangeResult(true, accessToken, scope, null);
        } catch (Exception e) {
            log.error("Shopify exchangeCode error shop={}", shop, e);
            return new TokenExchangeResult(false, null, null, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private static String snip(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    /**
     * 拉近 30 天 paid 订单聚合（GMV + 订单数 + 本币）。
     *
     * <p>实现：调 GET /admin/api/{ver}/orders.json?status=any&financial_status=paid&
     *   created_at_min=&fields=id,total_price,currency&limit=250&page_info=...
     * REST 翻页通过响应 Link header 的 rel="next" page_info；最多拉 MAX_PAGES 页防失控
     * （10 页 = 2500 单足以覆盖大多数中型店）。订单多时可能 30s+，调用方应在后台跑。
     *
     * <p>失败时返 ok=false + error，调用方决定是否覆盖旧值。本币取首单 currency。
     */
    public OrdersMetric fetchOrders30dMetric(String myshopifyDomain, String accessToken) {
        final int MAX_PAGES = 10;
        try {
            String since = java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC)
                .minusDays(30)
                .format(java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME);
            String url = apiBaseUrl + myshopifyDomain + "/admin/api/" + apiVersion
                + "/orders.json?status=any&financial_status=paid&limit=250&fields=id,total_price,currency"
                + "&created_at_min=" + java.net.URLEncoder.encode(since, java.nio.charset.StandardCharsets.UTF_8);

            java.math.BigDecimal gmv = java.math.BigDecimal.ZERO;
            int count = 0;
            String currency = null;
            int pages = 0;
            while (url != null && pages < MAX_PAGES) {
                HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .header("X-Shopify-Access-Token", accessToken)
                    .timeout(Duration.ofSeconds(20))
                    .GET().build();
                HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (resp.statusCode() == 401 || resp.statusCode() == 403) {
                    return new OrdersMetric(false, null, 0, null, null,
                        "token rejected HTTP " + resp.statusCode());
                }
                if (resp.statusCode() != 200) {
                    return new OrdersMetric(false, null, 0, null, null,
                        "HTTP " + resp.statusCode() + ": " + snip(resp.body(), 200));
                }
                JsonNode orders = JSON.readTree(resp.body()).path("orders");
                if (orders.isArray()) {
                    for (JsonNode o : orders) {
                        String tp = o.path("total_price").asText(null);
                        if (tp != null) {
                            try { gmv = gmv.add(new java.math.BigDecimal(tp)); } catch (Exception ignored) {}
                        }
                        if (currency == null) {
                            String c = o.path("currency").asText(null);
                            if (c != null && !c.isBlank()) currency = c;
                        }
                        count++;
                    }
                }
                // REST 翻页：Link: <...&page_info=xyz>; rel="next"
                url = parseNextLink(resp.headers().firstValue("Link").orElse(null), apiBaseUrl, myshopifyDomain, apiVersion);
                pages++;
            }
            return new OrdersMetric(true,
                gmv.setScale(2, java.math.RoundingMode.HALF_UP),
                count,
                currency != null ? currency : "USD",
                java.time.Instant.now(),
                null);
        } catch (Exception e) {
            log.warn("Shopify fetchOrders30dMetric error domain={} err={}",
                myshopifyDomain, e.getMessage());
            return new OrdersMetric(false, null, 0, null, null,
                e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** 从 Link header 抠下一页绝对 URL；找不到返 null（终止翻页）。 */
    private static String parseNextLink(String linkHeader, String base, String domain, String version) {
        if (linkHeader == null || linkHeader.isBlank()) return null;
        // 形如：<https://shop.myshopify.com/admin/api/.../orders.json?page_info=xxx&limit=250>; rel="next", <...>; rel="previous"
        for (String part : linkHeader.split(",")) {
            String s = part.trim();
            if (!s.contains("rel=\"next\"")) continue;
            int lt = s.indexOf('<'), gt = s.indexOf('>');
            if (lt < 0 || gt < 0 || gt <= lt + 1) return null;
            return s.substring(lt + 1, gt);
        }
        return null;
    }

    public record ShopInfo(boolean ok, String name, String error) {}
    public record TokenExchangeResult(boolean ok, String accessToken, String scope, String error) {}
    public record ShopDetail(boolean ok, int statusCode, String name, String planName, String error) {}
    public record OrdersMetric(
        boolean ok,
        java.math.BigDecimal gmv,
        int orderCount,
        String currency,
        java.time.Instant fetchedAt,
        String error
    ) {}
}
