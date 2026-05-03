package com.biou.shopifyhub.store;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.security.AesGcmUtil;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

/**
 * Shopify OAuth 公网回调 (W1-STORE-02)。
 *
 * 流程：
 *   1. 前端 → POST /oauth/shopify/init {shopDomain} → 后端拼 OAuth URL（state HMAC 防伪 + Redis 缓存 10min）
 *   2. 前端打开新窗 → 用户在 Shopify 同意 → Shopify 跳回 /oauth/callback?code&shop&state
 *   3. /oauth/callback：验 state、换 token、AES 入 store 表、跳前端成功页
 */
@RestController
@RequestMapping
public class ShopifyOAuthController {

    private static final Logger log = LoggerFactory.getLogger(ShopifyOAuthController.class);
    private static final Duration STATE_TTL = Duration.ofMinutes(10);

    private final StoreMapper storeMapper;
    private final ShopifyApiClient shopify;
    private final StringRedisTemplate redis;

    @Value("${SHOPIFY_APP_KEY:}")
    private String apiKey;

    @Value("${SHOPIFY_APP_SECRET:}")
    private String apiSecret;

    @Value("${SHOPIFY_OAUTH_REDIRECT_URI:http://localhost:8080/api/oauth/callback}")
    private String redirectUri;

    @Value("${SHOPIFY_FRONTEND_REDIRECT:http://localhost:3000/stores}")
    private String frontendRedirect;

    @Value("${ENCRYPT_KEY_AES_GCM:}")
    private String aesKey;

    private static final String OAUTH_SCOPES =
        "read_themes,write_themes,read_files,write_files,"
      + "read_products,write_products,read_collections,write_collections,"
      + "read_content,write_content,read_locales,write_locales";

    public ShopifyOAuthController(StoreMapper storeMapper, ShopifyApiClient shopify, StringRedisTemplate redis) {
        this.storeMapper = storeMapper;
        this.shopify = shopify;
        this.redis = redis;
    }

    @PostMapping("/oauth/shopify/init")
    public Result<Map<String, String>> init(@RequestBody InitReq req) {
        ensureConfigured();
        String domain = (req.shopDomain == null ? "" : req.shopDomain.trim()).toLowerCase();
        if (!domain.endsWith(".myshopify.com")) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "请提供 *.myshopify.com 域名");
        }
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        Long tenantId = req.tenantId != null ? req.tenantId : 1L;

        String state = newState();
        String stateKey = "oauth:shopify:state:" + state;
        String value = uid + "|" + tenantId + "|" + domain + "|" + System.currentTimeMillis();
        redis.opsForValue().set(stateKey, value, STATE_TTL);

        String authUrl = "https://" + domain + "/admin/oauth/authorize"
            + "?client_id=" + enc(apiKey)
            + "&scope=" + enc(OAUTH_SCOPES)
            + "&redirect_uri=" + enc(redirectUri)
            + "&state=" + enc(state);
        return Result.ok(Map.of("authUrl", authUrl, "state", state));
    }

    @GetMapping("/oauth/callback")
    public void callback(
        @RequestParam String code,
        @RequestParam String shop,
        @RequestParam String state,
        @RequestParam(required = false) String hmac,
        jakarta.servlet.http.HttpServletRequest request,
        HttpServletResponse response
    ) throws IOException {
        ensureConfigured();
        String stateKey = "oauth:shopify:state:" + state;
        String saved = redis.opsForValue().get(stateKey);
        if (saved == null) {
            redirectError(response, "state 已过期或不存在");
            return;
        }
        redis.delete(stateKey);

        String[] parts = saved.split("\\|", 4);
        Long uid = Long.parseLong(parts[0]);
        Long tenantId = Long.parseLong(parts[1]);
        String savedDomain = parts[2];
        if (!savedDomain.equalsIgnoreCase(shop)) {
            redirectError(response, "shop 与发起时不匹配");
            return;
        }

        // 校验 hmac（Shopify 规则：所有 query 参数除 hmac 外，按 key 字典序拼接 k=v&k=v → HMAC-SHA256(api_secret) hex）
        if (hmac != null && !verifyHmac(collectHmacParams(request), hmac)) {
            log.warn("Shopify callback hmac mismatch shop={}", shop);
            redirectError(response, "HMAC 校验失败");
            return;
        }

        // 换 token
        ShopifyApiClient.TokenExchangeResult tok = shopify.exchangeCode(shop, code, apiKey, apiSecret);
        if (!tok.ok()) {
            redirectError(response, "换 token 失败: " + tok.error());
            return;
        }

        // 写 store 表（已存在则更新 token）
        // store.scopes 是 MySQL JSON 列；Shopify 返回逗号分隔字符串，必须编码成 JSON 数组字面量再入库
        String scopesJson = encodeScopesJson(tok.scope());
        Store existing = storeMapper.selectOne(new QueryWrapper<Store>().eq("myshopify_domain", shop));
        if (existing == null) {
            Store s = new Store();
            s.setTenantId(tenantId);
            s.setMyshopifyDomain(shop);
            s.setBrandName(shop);
            s.setTokenType("oauth");
            s.setEncryptedAccessToken(AesGcmUtil.encrypt(tok.accessToken(), aesKey));
            s.setScopes(scopesJson);
            s.setIsDevStore(false);
            s.setIsPartnerCollab(false);
            s.setStatus("ACTIVE");
            storeMapper.insert(s);
        } else {
            existing.setEncryptedAccessToken(AesGcmUtil.encrypt(tok.accessToken(), aesKey));
            if (scopesJson != null) existing.setScopes(scopesJson);
            existing.setStatus("ACTIVE");
            existing.setLastRefreshAt(java.time.LocalDateTime.now());
            storeMapper.updateById(existing);
        }
        log.info("[shopify-oauth] connected shop={} by user={}", shop, uid);

        response.sendRedirect(frontendRedirect + "?connected=" + enc(shop));
    }

    private void ensureConfigured() {
        if (apiKey == null || apiKey.isBlank() || apiSecret == null || apiSecret.isBlank()) {
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "Shopify SHOPIFY_APP_KEY/SECRET 未配置");
        }
    }

    private void redirectError(HttpServletResponse response, String msg) throws IOException {
        log.warn("Shopify OAuth callback error: {}", msg);
        response.sendRedirect(frontendRedirect + "?error=" + enc(msg));
    }

    private boolean verifyHmac(Map<String, String> params, String providedHmac) {
        try {
            // 按 key 字典序拼接 k=v&k=v
            String message = params.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> e.getKey() + "=" + e.getValue())
                .reduce((a, b) -> a + "&" + b).orElse("");
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(apiSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] full = mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : full) hex.append(String.format("%02x", b));
            return hex.toString().equalsIgnoreCase(providedHmac);
        } catch (Exception e) {
            log.warn("HMAC verify exception: {}", e.getMessage());
            return false;
        }
    }

    /**
     * 收集回调 URL 上除 hmac/signature 外的所有 query 参数用于 HMAC 校验。
     * Shopify 实际回调常见字段：code, host, shop, state, timestamp（漏一个就 hash 不上）。
     */
    private Map<String, String> collectHmacParams(jakarta.servlet.http.HttpServletRequest request) {
        java.util.TreeMap<String, String> out = new java.util.TreeMap<>();
        request.getParameterMap().forEach((k, v) -> {
            if ("hmac".equals(k) || "signature".equals(k)) return;
            if (v != null && v.length > 0) out.put(k, v[0]);
        });
        return out;
    }

    /** store.scopes 是 MySQL JSON 列；Shopify 返回逗号分隔字符串，编码成 JSON 数组字面量。 */
    private static String encodeScopesJson(String scope) {
        if (scope == null) return null;
        String trimmed = scope.trim();
        if (trimmed.isEmpty()) return null;
        if (trimmed.startsWith("[")) return trimmed;
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (String p : trimmed.split(",")) {
            String t = p.trim();
            if (t.isEmpty()) continue;
            if (!first) sb.append(',');
            sb.append('"').append(t.replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
            first = false;
        }
        sb.append(']');
        return sb.toString();
    }

    private static String newState() {
        return Base64.getUrlEncoder().withoutPadding()
            .encodeToString(UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String enc(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }

    public static class InitReq {
        public String shopDomain;
        public Long tenantId;
    }
}
