package com.biou.shopifyhub.newstore;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.security.AesGcmUtil;
import com.biou.shopifyhub.store.ShopifyApiClient;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * W3-NEW-02: Saga AUTH_DONE 步实现。
 *
 * 提供两种路径将一个 saga 从 INIT 推进到 AUTH_DONE：
 *  1) 真实 Shopify OAuth：{@link #buildInstallUrl} → 用户跳转 → {@link #handleCallback}
 *     在 Shopify partner app 同意后回调，换 access token，落 store，advance saga。
 *  2) Dev mock：{@link #mockAuth}（受 {@code shopify.dev-mock-oauth=true} 控制），
 *     直接用调用方提供的 shopDomain + token 落 store，跳过真实 Shopify OAuth，
 *     用于 dev / e2e（未在公网部署 Partner App 时也能跑通整个 saga）。
 *
 * 与 W1-STORE-02 现有 {@code /oauth/callback}（store-add 流程）独立：
 *   - 本服务的回调路径是 {@code /oauth/saga-callback}；
 *   - state 通过 HMAC-SHA256 签名 saga taskId（key = AES 主密钥），
 *     无需 Redis 持久化（dev 简化方案，生产走 W3-NEW-12 加固）。
 */
@Service
public class SagaAuthService {

    private static final Logger log = LoggerFactory.getLogger(SagaAuthService.class);

    /** Shopify install 默认 scopes。覆盖后续 saga 步骤所需：products / themes / files / collections / metafields；
     *  + V32 店铺管理卡片读 orders.json 算 GMV/订单数。 */
    private static final String OAUTH_SCOPES =
        "read_themes,write_themes,read_files,write_files,"
      + "read_products,write_products,read_collections,write_collections,"
      + "read_content,write_content,read_locales,write_locales,"
      + "read_orders";

    private final SagaService sagaService;
    private final StoreMapper storeMapper;
    private final ShopifyApiClient shopifyApiClient;
    private final ObjectMapper objectMapper;

    @Value("${ENCRYPT_KEY_AES_GCM:}")
    private String aesKey;

    @Value("${SHOPIFY_APP_KEY:}")
    private String shopifyAppKey;

    @Value("${SHOPIFY_APP_SECRET:}")
    private String shopifyAppSecret;

    @Value("${shopify.oauth.callback-base:http://localhost:8080/api}")
    private String oauthCallbackBase;

    @Value("${shopify.dev-mock-oauth:true}")
    private boolean devMockOauth;

    public SagaAuthService(SagaService sagaService,
                           StoreMapper storeMapper,
                           ShopifyApiClient shopifyApiClient,
                           ObjectMapper objectMapper) {
        this.sagaService = sagaService;
        this.storeMapper = storeMapper;
        this.shopifyApiClient = shopifyApiClient;
        this.objectMapper = objectMapper;
    }

    /**
     * 构造 Shopify install URL；state 内嵌 saga taskId 并签 HMAC。
     * 若 shopDomainHint 为空，返回 null —— 由 caller 决定让前端先收集域名。
     */
    public String buildInstallUrl(Long sagaTaskId, String shopDomainHint) {
        if (shopDomainHint == null || shopDomainHint.isBlank()) {
            return null;
        }
        String domain = shopDomainHint.trim().toLowerCase();
        if (!domain.endsWith(".myshopify.com")) {
            throw new IllegalArgumentException("shopDomainHint 必须以 .myshopify.com 结尾");
        }
        String state = signState(sagaTaskId);
        String redirect = oauthCallbackBase + "/oauth/saga-callback";
        return "https://" + domain + "/admin/oauth/authorize"
            + "?client_id=" + enc(shopifyAppKey)
            + "&scope=" + enc(OAUTH_SCOPES)
            + "&redirect_uri=" + enc(redirect)
            + "&state=" + enc(state);
    }

    /** state 格式：base64url(taskId) + "." + base64url(HMAC-SHA256(taskId, hmacKey))。 */
    String signState(Long taskId) {
        String payload = String.valueOf(taskId);
        byte[] sig = hmacSha256(payload.getBytes(StandardCharsets.UTF_8), hmacKeyBytes());
        return b64url(payload.getBytes(StandardCharsets.UTF_8)) + "." + b64url(sig);
    }

    /** 校验 state 并提取 saga taskId；非法/篡改返回 null。 */
    public Long verifyAndExtractTaskId(String state) {
        if (state == null || state.isBlank()) return null;
        int dot = state.indexOf('.');
        if (dot <= 0 || dot == state.length() - 1) return null;
        try {
            byte[] payload = Base64.getUrlDecoder().decode(state.substring(0, dot));
            byte[] providedSig = Base64.getUrlDecoder().decode(state.substring(dot + 1));
            byte[] expectedSig = hmacSha256(payload, hmacKeyBytes());
            if (!constantTimeEquals(providedSig, expectedSig)) return null;
            return Long.parseLong(new String(payload, StandardCharsets.UTF_8));
        } catch (Exception e) {
            log.warn("[saga-oauth] invalid state: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 真实 OAuth 回调入口：换 token → 落 store → advance saga 到 AUTH_DONE。
     * 不验 Shopify HMAC（Wave 1 store-add 已有；saga 路径是私有 saga 协议，state HMAC 已防篡改）。
     */
    public Map<String, Object> handleCallback(String code, String shop, String state, String hmac) {
        Long taskId = verifyAndExtractTaskId(state);
        if (taskId == null) throw new IllegalStateException("invalid OAuth state");
        if (shop == null || shop.isBlank()) throw new IllegalArgumentException("shop 不能为空");
        if (code == null || code.isBlank()) throw new IllegalArgumentException("code 不能为空");
        if (shopifyAppKey == null || shopifyAppKey.isBlank()
            || shopifyAppSecret == null || shopifyAppSecret.isBlank()) {
            throw new IllegalStateException("SHOPIFY_APP_KEY/SECRET 未配置；dev 请走 /saga/{id}/dev-mock-auth");
        }
        ShopifyApiClient.TokenExchangeResult tok =
            shopifyApiClient.exchangeCode(shop, code, shopifyAppKey, shopifyAppSecret);
        if (!tok.ok()) {
            throw new IllegalStateException("Shopify token exchange failed: " + tok.error());
        }
        SagaContext ctx = sagaService.loadContext(taskId);
        Long storeId = upsertStore(shop, tok.accessToken(), tok.scope(), ctx.tenantId(), false);
        SagaContext updated = withAuth(ctx, storeId, shop, tok.accessToken());
        sagaService.advance(taskId, updated);
        log.info("[saga-oauth] AUTH_DONE taskId={} storeId={} shop={}", taskId, storeId, shop);

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("taskId", taskId);
        r.put("storeId", storeId);
        r.put("step", "AUTH_DONE");
        return r;
    }

    /**
     * Dev mock：跳过真 Shopify OAuth，直接用调用方提供的 token 落 store + 推进 saga。
     * 仅当 {@code shopify.dev-mock-oauth=true} 时启用；生产应设 false。
     */
    public Map<String, Object> mockAuth(Long taskId, String shopDomain, String accessToken) {
        if (!devMockOauth) {
            throw new IllegalStateException("mock OAuth 已禁用（设 shopify.dev-mock-oauth=true 启用）");
        }
        if (shopDomain == null || shopDomain.isBlank()) {
            throw new IllegalArgumentException("shopDomain 不能为空");
        }
        if (accessToken == null || accessToken.isBlank()) {
            throw new IllegalArgumentException("accessToken 不能为空");
        }
        String domain = shopDomain.trim().toLowerCase();
        if (!domain.endsWith(".myshopify.com")) {
            throw new IllegalArgumentException("shopDomain 必须以 .myshopify.com 结尾");
        }
        SagaContext ctx = sagaService.loadContext(taskId);
        Long storeId = upsertStore(domain, accessToken, OAUTH_SCOPES, ctx.tenantId(), true);
        SagaContext updated = withAuth(ctx, storeId, domain, accessToken);
        sagaService.advance(taskId, updated);
        log.info("[saga-oauth] mockAuth AUTH_DONE taskId={} storeId={} shop={}", taskId, storeId, domain);

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("taskId", taskId);
        r.put("storeId", storeId);
        r.put("step", "AUTH_DONE");
        r.put("mock", true);
        return r;
    }

    /** 已存在域名 → 刷新 token；否则新插入 ACTIVE 行。返回 store.id。 */
    private Long upsertStore(String shopDomain, String accessToken, String scope, Long tenantId, boolean mock) {
        if (aesKey == null || aesKey.isBlank()) {
            throw new IllegalStateException("ENCRYPT_KEY_AES_GCM 未配置");
        }
        String enc = AesGcmUtil.encrypt(accessToken, aesKey);
        String scopesJson = encodeScopesJson(scope);
        Store existing = storeMapper.selectOne(new QueryWrapper<Store>().eq("myshopify_domain", shopDomain));
        if (existing != null) {
            existing.setEncryptedAccessToken(enc);
            if (scopesJson != null) existing.setScopes(scopesJson);
            existing.setStatus("ACTIVE");
            existing.setLastRefreshAt(LocalDateTime.now());
            if (existing.getTenantId() == null && tenantId != null) existing.setTenantId(tenantId);
            storeMapper.updateById(existing);
            return existing.getId();
        }
        Store s = new Store();
        s.setTenantId(tenantId);
        s.setMyshopifyDomain(shopDomain);
        s.setBrandName(shopDomain);
        // 使用 'oauth' 以兼容 store.token_type ENUM('cli','custom_app','oauth')；
        // mock=true 仅在日志中区分。
        s.setTokenType("oauth");
        s.setEncryptedAccessToken(enc);
        s.setScopes(scopesJson);
        s.setIsDevStore(false);
        s.setIsPartnerCollab(false);
        s.setStatus("ACTIVE");
        storeMapper.insert(s);
        return s.getId();
    }

    /** scopes 列是 MySQL JSON 类型；接受逗号分隔字符串，编码成 JSON 数组字面量。 */
    private String encodeScopesJson(String scope) {
        if (scope == null) return null;
        String trimmed = scope.trim();
        if (trimmed.isEmpty()) return null;
        // 已是 JSON 数组直接透传
        if (trimmed.startsWith("[")) return trimmed;
        try {
            String[] parts = trimmed.split(",");
            java.util.List<String> list = new java.util.ArrayList<>(parts.length);
            for (String p : parts) {
                String t = p.trim();
                if (!t.isEmpty()) list.add(t);
            }
            return objectMapper.writeValueAsString(list);
        } catch (Exception e) {
            return null;
        }
    }

    private SagaContext withAuth(SagaContext ctx, Long storeId, String domain, String token) {
        return new SagaContext(
            ctx.taskId(), ctx.tenantId(), storeId, domain, token,
            ctx.templateId(), ctx.replaceRules(), ctx.productIdsToPush(), ctx.stepOutputs()
        );
    }

    /**
     * HMAC key：优先 SHOPIFY_APP_SECRET（与 Shopify 自身签名同源），缺失时 fallback 到 AES 主密钥，
     * 再缺失则用一个固定 dev 默认值（仅启动期 / dev）。
     */
    private byte[] hmacKeyBytes() {
        if (shopifyAppSecret != null && !shopifyAppSecret.isBlank()) {
            return shopifyAppSecret.getBytes(StandardCharsets.UTF_8);
        }
        if (aesKey != null && !aesKey.isBlank()) {
            return aesKey.getBytes(StandardCharsets.UTF_8);
        }
        return "dev-saga-state-fallback-secret".getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] hmacSha256(byte[] message, byte[] key) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message);
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 failed", e);
        }
    }

    private static boolean constantTimeEquals(byte[] a, byte[] b) {
        if (a == null || b == null || a.length != b.length) return false;
        int diff = 0;
        for (int i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }

    private static String b64url(byte[] data) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
    }

    private static String enc(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }
}
