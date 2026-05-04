package com.biou.shopifyhub.webhook;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.push.entity.StoreProduct;
import com.biou.shopifyhub.push.mapper.StoreProductMapper;
import com.biou.shopifyhub.snapshot.PriceInventoryHistoryService;
import com.biou.shopifyhub.snapshot.SnapshotDebounceService;
import com.biou.shopifyhub.snapshot.entity.ProductSnapshot;
import com.biou.shopifyhub.snapshot.mapper.ProductSnapshotMapper;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/**
 * Shopify products/* webhook receiver (W2-SNAP-02).
 *
 * <p>Behavior:
 * <ul>
 *   <li>Verifies HMAC-SHA256 of raw body via {@link ShopifyHmacVerifier}.
 *       If secret is unconfigured (dev), verification is skipped + WARN logged.
 *   <li>If HMAC mismatch (with secret configured) → 401.
 *   <li>Looks up store by X-Shopify-Shop-Domain. Unknown shop → 200 + WARN, no insert.
 *   <li>Inserts one {@code product_snapshot} row with status=PENDING, trigger=WEBHOOK_UPDATE.
 *   <li>Diff metadata only (topic, received_at, shop_domain) — full diff is W2-SNAP-04.
 * </ul>
 *
 * <p>Async snapshot generation, dedup, R2 upload — all deferred to W2-SNAP-03/04.
 */
@RestController
@RequestMapping("/webhook/shopify/products")
public class ProductWebhookController {

    private static final Logger log = LoggerFactory.getLogger(ProductWebhookController.class);

    private final ShopifyHmacVerifier hmac;
    private final ObjectMapper objectMapper;
    private final StoreMapper storeMapper;
    private final ProductSnapshotMapper snapshotMapper;
    private final SnapshotDebounceService debounceService;
    private final PriceInventoryHistoryService priceInvService;
    private final StoreProductMapper storeProductMapper;

    public ProductWebhookController(ShopifyHmacVerifier hmac,
                                    ObjectMapper objectMapper,
                                    StoreMapper storeMapper,
                                    ProductSnapshotMapper snapshotMapper,
                                    SnapshotDebounceService debounceService,
                                    PriceInventoryHistoryService priceInvService,
                                    StoreProductMapper storeProductMapper) {
        this.hmac = hmac;
        this.objectMapper = objectMapper;
        this.storeMapper = storeMapper;
        this.snapshotMapper = snapshotMapper;
        this.debounceService = debounceService;
        this.priceInvService = priceInvService;
        this.storeProductMapper = storeProductMapper;
    }

    @PostMapping("/update")
    public ResponseEntity<Void> update(@RequestBody(required = false) byte[] rawBody,
                                       @RequestHeader(value = "X-Shopify-Hmac-Sha256", required = false) String hmacHeader,
                                       @RequestHeader(value = "X-Shopify-Topic", required = false) String topic,
                                       @RequestHeader(value = "X-Shopify-Shop-Domain", required = false) String shopDomain) {
        return handle(rawBody, fallbackTopic(topic, "products/update"), hmacHeader, shopDomain);
    }

    @PostMapping("/create")
    public ResponseEntity<Void> create(@RequestBody(required = false) byte[] rawBody,
                                       @RequestHeader(value = "X-Shopify-Hmac-Sha256", required = false) String hmacHeader,
                                       @RequestHeader(value = "X-Shopify-Topic", required = false) String topic,
                                       @RequestHeader(value = "X-Shopify-Shop-Domain", required = false) String shopDomain) {
        return handle(rawBody, fallbackTopic(topic, "products/create"), hmacHeader, shopDomain);
    }

    @PostMapping("/delete")
    public ResponseEntity<Void> delete(@RequestBody(required = false) byte[] rawBody,
                                       @RequestHeader(value = "X-Shopify-Hmac-Sha256", required = false) String hmacHeader,
                                       @RequestHeader(value = "X-Shopify-Topic", required = false) String topic,
                                       @RequestHeader(value = "X-Shopify-Shop-Domain", required = false) String shopDomain) {
        return handle(rawBody, fallbackTopic(topic, "products/delete"), hmacHeader, shopDomain);
    }

    private static String fallbackTopic(String fromHeader, String fromPath) {
        return (fromHeader == null || fromHeader.isBlank()) ? fromPath : fromHeader;
    }

    private ResponseEntity<Void> handle(byte[] rawBody, String topic, String hmacHeader, String shopDomain) {
        byte[] body = rawBody == null ? new byte[0] : rawBody;

        // 1) HMAC verify (skipped if secret unconfigured — verifier logs WARN itself)
        if (!hmac.verify(body, hmacHeader)) {
            log.warn("[webhook] HMAC mismatch topic={} shop={} bodyLen={}", topic, shopDomain, body.length);
            return ResponseEntity.status(401).build();
        }

        // 2) Resolve store by shop domain
        if (shopDomain == null || shopDomain.isBlank()) {
            log.warn("[webhook] missing X-Shopify-Shop-Domain header topic={} — accepting but skipping insert", topic);
            return ResponseEntity.ok().build();
        }
        Store store;
        try {
            store = storeMapper.selectOne(
                new QueryWrapper<Store>().eq("myshopify_domain", shopDomain.trim().toLowerCase()).last("LIMIT 1"));
        } catch (Exception e) {
            log.error("[webhook] store lookup failure shop={}: {}", shopDomain, e.getMessage(), e);
            // still 200 — Shopify retries on non-2xx; we'd rather drop than thrash
            return ResponseEntity.ok().build();
        }
        if (store == null) {
            log.warn("[webhook] unknown shop_domain={} topic={} — accepting but skipping insert", shopDomain, topic);
            return ResponseEntity.ok().build();
        }

        // 3) Parse minimal product info (just need id)
        String productExternalId = null;
        try {
            if (body.length > 0) {
                JsonNode root = objectMapper.readTree(new String(body, StandardCharsets.UTF_8));
                JsonNode idNode = root.get("id");
                if (idNode != null && !idNode.isNull()) {
                    productExternalId = idNode.asText();
                }
            }
        } catch (Exception e) {
            log.warn("[webhook] body parse failure topic={} shop={}: {}", topic, shopDomain, e.getMessage());
        }
        if (productExternalId == null || productExternalId.isBlank()) {
            log.warn("[webhook] body has no product id; topic={} shop={} — accepting but skipping insert", topic, shopDomain);
            return ResponseEntity.ok().build();
        }

        // 4) Build diff_summary metadata (full diff = W2-SNAP-04)
        ObjectNode meta = objectMapper.createObjectNode();
        meta.put("topic", topic);
        meta.put("received_at", OffsetDateTime.now(ZoneOffset.UTC).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
        meta.put("shop_domain", shopDomain);
        String diffSummaryJson;
        try {
            diffSummaryJson = objectMapper.writeValueAsString(meta);
        } catch (Exception e) {
            diffSummaryJson = "{}";
        }

        // 5) Insert snapshot row (PENDING)
        ProductSnapshot snap = null;
        try {
            // 反查 store_product 拿平台 product.id；映射不存在保持 null（首次 webhook 早于 push 时）
            StoreProduct sp = storeProductMapper.selectOne(
                new QueryWrapper<StoreProduct>()
                    .eq("store_id", store.getId())
                    .eq("shopify_product_id", productExternalId)
                    .last("LIMIT 1")
            );
            snap = new ProductSnapshot();
            snap.setTenantId(store.getTenantId());
            snap.setStoreId(store.getId());
            snap.setProductExternalId(productExternalId);
            snap.setProductId(sp == null ? null : sp.getProductId());
            snap.setTriggerEvent("WEBHOOK_UPDATE");
            snap.setStatus("PENDING");
            snap.setDiffSummaryJson(diffSummaryJson);
            snapshotMapper.insert(snap);
            log.info("[webhook] snapshot row inserted id={} topic={} shop={} productExt={} tenant={} store={}",
                snap.getId(), topic, shopDomain, productExternalId, store.getTenantId(), store.getId());
        } catch (Exception e) {
            log.error("[webhook] snapshot insert failure topic={} shop={} productExt={}: {}",
                topic, shopDomain, productExternalId, e.getMessage(), e);
            // still 200 to avoid Shopify retry storm
            return ResponseEntity.ok().build();
        }

        // 6) W2-SNAP-03: try Redis-NX debounce + RabbitMQ TTL/DLX delayed publish.
        //    Skip for delete-topic (delete is terminal, no snapshot regeneration value).
        //    Failures here are no-op safe — webhook still returns 200; the PENDING row remains
        //    and a future webhook (or W2-SNAP-04 fallback DB scan) will pick it up.
        if (snap != null && snap.getId() != null && !"products/delete".equalsIgnoreCase(topic)) {
            try {
                debounceService.tryEnqueue(
                    snap.getId(), snap.getTenantId(), snap.getStoreId(), snap.getProductExternalId());
            } catch (Exception e) {
                log.warn("[webhook] debounce enqueue threw (still 200): id={} err={}",
                    snap.getId(), e.getMessage());
            }
        }

        // 7) W2-SNAP-05: emit price/inventory history rows for variants whose values changed.
        //    Skip for delete (no variants payload of interest). All failures are swallowed —
        //    webhook MUST always return 200 to avoid Shopify retry storm.
        if (body.length > 0 && !"products/delete".equalsIgnoreCase(topic)) {
            try {
                JsonNode root = objectMapper.readTree(body);
                JsonNode variantsNode = root.path("variants");
                if (variantsNode.isArray() && variantsNode.size() > 0) {
                    List<Map<String, Object>> variants = objectMapper.convertValue(
                        variantsNode, new TypeReference<List<Map<String, Object>>>() {});
                    PriceInventoryHistoryService.Stats stats = priceInvService.record(
                        store.getTenantId(), store.getId(), productExternalId, variants, topic);
                    if (stats.priceInserts() > 0 || stats.inventoryInserts() > 0) {
                        log.info("[webhook] history recorded: store={} product={} priceRows={} invRows={}",
                            store.getId(), productExternalId, stats.priceInserts(), stats.inventoryInserts());
                    }
                }
            } catch (Exception e) {
                log.warn("[webhook] history recording failed (non-fatal): store={} product={} err={}",
                    store.getId(), productExternalId, e.getMessage());
            }
        }

        return ResponseEntity.ok().build();
    }
}
