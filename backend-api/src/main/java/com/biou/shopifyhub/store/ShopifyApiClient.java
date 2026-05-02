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

    /** 调 /admin/api/{ver}/shop.json 验证 token 是否有效 + 返回 shop 基本信息。 */
    public ShopInfo verifyToken(String myshopifyDomain, String accessToken) {
        try {
            String url = "https://" + myshopifyDomain + "/admin/api/" + apiVersion + "/shop.json";
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

    /** OAuth code → access_token */
    public TokenExchangeResult exchangeCode(String shop, String code, String apiKey, String apiSecret) {
        try {
            String url = "https://" + shop + "/admin/oauth/access_token";
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

    public record ShopInfo(boolean ok, String name, String error) {}
    public record TokenExchangeResult(boolean ok, String accessToken, String scope, String error) {}
}
