package com.biou.shopifyhub.core.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;

/**
 * USD → CNY 实时汇率代理 + Redis 缓存。
 *
 * <p>前端 header 显示用。**不**承担金融场景计算（采购成本币种切换由前端单选），
 * 仅做信息提示，1 小时刷一次足够。
 *
 * <p>外部 API：https://open.er-api.com/v6/latest/USD（无需 key、CORS 友好但
 * 我们仍走后端代理避免 CSP connect-src 放外部域）。失败时返 cached 值，
 * 全部失败则返 null + error。
 */
@Service
public class ExchangeRateService {

    private static final Logger log = LoggerFactory.getLogger(ExchangeRateService.class);
    private static final String REDIS_KEY = "util:rate:usdcny";
    private static final Duration CACHE_TTL = Duration.ofHours(1);
    private static final Duration FETCH_TIMEOUT = Duration.ofSeconds(5);

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final HttpClient http;

    @Value("${exchange-rate.api-url:https://open.er-api.com/v6/latest/USD}")
    private String apiUrl;

    public ExchangeRateService(StringRedisTemplate redis, ObjectMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
        this.http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    }

    public Snapshot getUsdCny() {
        String cached = safeRedisGet(REDIS_KEY);
        if (cached != null) {
            try {
                JsonNode node = mapper.readTree(cached);
                BigDecimal rate = new BigDecimal(node.get("rate").asText());
                long fetchedAt = node.get("fetchedAt").asLong();
                String source = node.has("source") ? node.get("source").asText() : "cache";
                return new Snapshot(rate, fetchedAt, source, null);
            } catch (Exception e) {
                log.warn("[exchange-rate] cache parse failed, refetching: {}", e.getMessage());
            }
        }
        return refresh();
    }

    /** 强制拉一次外部 API 并写缓存。 */
    public Snapshot refresh() {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(apiUrl))
                .timeout(FETCH_TIMEOUT)
                .GET()
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                throw new RuntimeException("HTTP " + resp.statusCode());
            }
            JsonNode root = mapper.readTree(resp.body());
            JsonNode cny = root.path("rates").path("CNY");
            if (cny.isMissingNode() || !cny.isNumber()) {
                throw new RuntimeException("CNY rate missing in response");
            }
            BigDecimal rate = new BigDecimal(cny.asText()).setScale(4, java.math.RoundingMode.HALF_UP);
            long fetchedAt = Instant.now().toEpochMilli();
            String source = "open.er-api.com";

            String json = mapper.writeValueAsString(java.util.Map.of(
                "rate", rate.toPlainString(),
                "fetchedAt", fetchedAt,
                "source", source
            ));
            try {
                redis.opsForValue().set(REDIS_KEY, json, CACHE_TTL);
            } catch (Exception e) {
                log.warn("[exchange-rate] redis cache set failed: {}", e.getMessage());
            }
            return new Snapshot(rate, fetchedAt, source, null);
        } catch (Exception e) {
            log.warn("[exchange-rate] fetch failed: {}", e.getMessage());
            return new Snapshot(null, Instant.now().toEpochMilli(), "error", e.getMessage());
        }
    }

    private String safeRedisGet(String key) {
        try {
            return redis.opsForValue().get(key);
        } catch (Exception e) {
            log.debug("[exchange-rate] redis get failed: {}", e.getMessage());
            return null;
        }
    }

    public record Snapshot(BigDecimal rate, long fetchedAt, String source, String error) {}
}
