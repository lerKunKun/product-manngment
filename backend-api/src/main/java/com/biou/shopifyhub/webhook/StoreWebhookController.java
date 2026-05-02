package com.biou.shopifyhub.webhook;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Shopify store-lifecycle webhook receiver (W2-SYNC-01).
 *
 * <p>Handles non-product Shopify webhooks that change store-level state:
 * <ul>
 *   <li>{@code app/uninstalled} — flips local {@code store.status} to {@code UNINSTALLED}.</li>
 *   <li>{@code shop/update} — Day 7 scope: log + 200 only (no actionable local data yet).</li>
 * </ul>
 *
 * <p>Hard contract: all handlers return 200 to Shopify on errors (except 401 on HMAC mismatch
 * when the secret is configured) so Shopify does not retry storm. Internal failures are
 * swallowed + logged.
 *
 * <p>Note: {@code products/create|update|delete} are handled by
 * {@link ProductWebhookController} — do not duplicate here.
 */
@RestController
@RequestMapping("/webhook/shopify")
public class StoreWebhookController {

    private static final Logger log = LoggerFactory.getLogger(StoreWebhookController.class);

    private final ShopifyHmacVerifier hmac;
    private final StoreMapper storeMapper;
    private final ObjectMapper objectMapper;

    public StoreWebhookController(ShopifyHmacVerifier hmac,
                                  StoreMapper storeMapper,
                                  ObjectMapper objectMapper) {
        this.hmac = hmac;
        this.storeMapper = storeMapper;
        this.objectMapper = objectMapper;
    }

    /**
     * Shopify {@code app/uninstalled} topic. Flips {@code store.status} to {@code UNINSTALLED}.
     * Always 200 unless HMAC mismatch (401).
     */
    @PostMapping("/app/uninstalled")
    public ResponseEntity<Void> appUninstalled(
            @RequestBody(required = false) byte[] rawBody,
            @RequestHeader(value = "X-Shopify-Hmac-Sha256", required = false) String hmacHeader,
            @RequestHeader(value = "X-Shopify-Shop-Domain", required = false) String shopDomain) {
        byte[] body = rawBody == null ? new byte[0] : rawBody;
        if (!hmac.verify(body, hmacHeader)) {
            log.warn("[webhook] app/uninstalled HMAC mismatch domain={} bodyLen={}", shopDomain, body.length);
            return ResponseEntity.status(401).build();
        }
        if (shopDomain == null || shopDomain.isBlank()) {
            log.warn("[webhook] app/uninstalled missing X-Shopify-Shop-Domain — accepting + skipping");
            return ResponseEntity.ok().build();
        }
        try {
            Store s = storeMapper.selectOne(new QueryWrapper<Store>()
                .eq("myshopify_domain", shopDomain.trim().toLowerCase())
                .last("LIMIT 1"));
            if (s == null) {
                log.warn("[webhook] app/uninstalled unknown shop={} — accepting + skipping", shopDomain);
                return ResponseEntity.ok().build();
            }
            s.setStatus("UNINSTALLED");
            storeMapper.updateById(s);
            log.info("[webhook] store UNINSTALLED: id={} domain={}", s.getId(), shopDomain);
            // TODO(W2-PUSH-07 / W4-NTF): emit STORE_UNINSTALLED via NotificationDispatcher
        } catch (Exception e) {
            log.error("[webhook] app/uninstalled handler failed shop={}: {}", shopDomain, e.getMessage(), e);
            // still 200 — Shopify retries on non-2xx and we'd rather drop than thrash
        }
        return ResponseEntity.ok().build();
    }

    /**
     * Shopify {@code shop/update} topic. Day 7 scope: log + 200 only.
     * Shop name / email / currency changes are not actionable in local data yet.
     */
    @PostMapping("/shop/update")
    public ResponseEntity<Void> shopUpdate(
            @RequestBody(required = false) byte[] rawBody,
            @RequestHeader(value = "X-Shopify-Hmac-Sha256", required = false) String hmacHeader,
            @RequestHeader(value = "X-Shopify-Shop-Domain", required = false) String shopDomain) {
        byte[] body = rawBody == null ? new byte[0] : rawBody;
        if (!hmac.verify(body, hmacHeader)) {
            log.warn("[webhook] shop/update HMAC mismatch domain={} bodyLen={}", shopDomain, body.length);
            return ResponseEntity.status(401).build();
        }
        log.info("[webhook] shop/update received domain={} bodyLen={} — ack only (no local update)",
            shopDomain, body.length);
        // TODO: when we want to mirror shop name / currency / timezone into store table, parse + update here.
        return ResponseEntity.ok().build();
    }
}
