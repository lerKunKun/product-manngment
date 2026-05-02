package com.biou.shopifyhub.preview;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.preview.entity.PreviewTheme;
import com.biou.shopifyhub.preview.mapper.PreviewThemeMapper;
import com.biou.shopifyhub.product.entity.Product;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.entity.ProductVariant;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import com.biou.shopifyhub.product.mapper.ProductMapper;
import com.biou.shopifyhub.product.mapper.ProductVariantMapper;
import com.biou.shopifyhub.store.StoreService;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * W3-PV-05: orchestrate the call to asset-worker {@code POST /preview/build} after
 * {@link PreviewThemeAllocator#allocate} has reserved a {@code preview_theme} row.
 *
 * <p>This is the synchronous "back-half" of preview allocation: we look up the
 * dev store + decrypt its token, fetch the source product detail, build the
 * worker payload, and call the worker. The result is written back into the
 * same row (READY + shopify_theme_id + preview_url, or FAILED + error_message).
 *
 * <p>Failure semantics: this method <em>never throws</em>. Every error path
 * still ends with a {@code previewMapper.updateById(p)} flipping the row to
 * FAILED, so the caller (controller) can return the row as-is and the frontend
 * can poll/inspect status without ever seeing a 5xx for preview-build issues.
 *
 * <p>HTTP/1.1 enforced: same rationale as
 * {@link com.biou.shopifyhub.snapshot.SnapshotGenerationService} — uvicorn
 * rejects HTTP/2 h2c upgrade headers and drops the request body.
 */
@Service
public class PreviewBuildOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(PreviewBuildOrchestrator.class);
    private static final int MAX_ERR_LEN = 1000;

    private final PreviewThemeMapper previewMapper;
    private final StoreMapper storeMapper;
    private final StoreService storeService;
    private final ProductMapper productMapper;
    private final ProductVariantMapper variantMapper;
    private final ProductImageMapper imageMapper;
    private final ObjectMapper objectMapper;

    @Value("${shopify.worker.base-url:http://localhost:8765}")
    private String workerBaseUrl;

    @Value("${shopify.worker.call-timeout-seconds:120}")
    private long workerTimeoutSeconds;

    public PreviewBuildOrchestrator(PreviewThemeMapper previewMapper,
                                    StoreMapper storeMapper,
                                    StoreService storeService,
                                    ProductMapper productMapper,
                                    ProductVariantMapper variantMapper,
                                    ProductImageMapper imageMapper,
                                    ObjectMapper objectMapper) {
        this.previewMapper = previewMapper;
        this.storeMapper = storeMapper;
        this.storeService = storeService;
        this.productMapper = productMapper;
        this.variantMapper = variantMapper;
        this.imageMapper = imageMapper;
        this.objectMapper = objectMapper;
    }

    /**
     * Drive the worker call for a freshly-allocated PENDING preview row.
     * Idempotent flips: PENDING → BUILDING → READY/FAILED. On any exception we
     * still mark FAILED + completed_at so the row never sticks at BUILDING.
     */
    public void build(PreviewTheme p) {
        try {
            p.setStatus("BUILDING");
            previewMapper.updateById(p);

            Store devStore = storeMapper.selectById(p.getDevStoreId());
            if (devStore == null) {
                throw new IllegalStateException("dev store not found: id=" + p.getDevStoreId());
            }
            String token = null;
            try {
                token = storeService.decryptToken(devStore);
            } catch (Exception e) {
                log.warn("[preview-orch] decrypt token failed (continuing without) storeId={} err={}",
                    devStore.getId(), e.getMessage());
            }

            Map<String, Object> productPayload = buildProductPayload(p.getSourceProductId());

            Map<String, Object> reqBody = new LinkedHashMap<>();
            reqBody.put("shop_domain", devStore.getMyshopifyDomain());
            reqBody.put("tenant_id", p.getTenantId());
            reqBody.put("store_id", devStore.getId());
            reqBody.put("preview_id", p.getId());
            if (token != null && !token.isBlank()) {
                reqBody.put("access_token", token);
            }
            reqBody.put("product_payload", productPayload);

            Map<String, Object> resp = callWorker("/preview/build", reqBody);

            Object themeIdObj = resp.get("shopify_theme_id");
            p.setShopifyThemeId(themeIdObj == null ? null : String.valueOf(themeIdObj));

            // Prefer product_preview_url (URL with handle) so the user lands on
            // the real product page; fall back to bare preview_url.
            String url = asString(resp.get("product_preview_url"));
            if (url == null || url.isBlank()) {
                url = asString(resp.get("preview_url"));
            }
            p.setPreviewUrl(url);
            p.setStatus("READY");
            p.setCompletedAt(LocalDateTime.now());
            p.setErrorMessage(null);
            previewMapper.updateById(p);
            log.info("[preview-orch] READY id={} themeId={} url={}",
                p.getId(), p.getShopifyThemeId(), url);
        } catch (Exception e) {
            log.error("[preview-orch] FAILED id={} err={}", p.getId(), e.getMessage(), e);
            try {
                p.setStatus("FAILED");
                p.setErrorMessage(truncate(
                    e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(),
                    MAX_ERR_LEN));
                p.setCompletedAt(LocalDateTime.now());
                previewMapper.updateById(p);
            } catch (Exception markErr) {
                log.error("[preview-orch] failed to mark FAILED id={} err={}",
                    p.getId(), markErr.getMessage(), markErr);
            }
        }
    }

    /**
     * Assemble a Shopify-ish product payload (handle/title/body_html/vendor +
     * variants[] + images[]) for the worker. Worker uses {@code handle} for the
     * product-scoped preview URL and may push the product to the dev store.
     */
    private Map<String, Object> buildProductPayload(Long productId) {
        Product prod = productMapper.selectById(productId);
        if (prod == null) {
            throw new IllegalStateException("source product not found: id=" + productId);
        }
        List<ProductVariant> variants = variantMapper.selectList(
            new QueryWrapper<ProductVariant>().eq("product_id", productId).orderByAsc("position"));
        List<ProductImage> images = imageMapper.selectList(
            new QueryWrapper<ProductImage>().eq("product_id", productId).orderByAsc("position"));

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", prod.getId());
        payload.put("handle", prod.getHandle());
        payload.put("title", prod.getTitle());
        payload.put("body_html", prod.getBodyHtml());
        payload.put("vendor", prod.getVendor());
        payload.put("product_type", prod.getType());
        payload.put("tags", prod.getTags());
        payload.put("status", prod.getStatus());
        payload.put("published", prod.getPublished());

        List<Map<String, Object>> variantList = new ArrayList<>();
        for (ProductVariant v : variants) {
            Map<String, Object> vm = new LinkedHashMap<>();
            vm.put("sku", v.getSku());
            vm.put("price", v.getPrice());
            vm.put("compare_at_price", v.getCompareAtPrice());
            vm.put("position", v.getPosition());
            vm.put("option1", v.getOption1());
            vm.put("option2", v.getOption2());
            vm.put("option3", v.getOption3());
            vm.put("inventory_quantity", v.getInventoryQty());
            vm.put("inventory_policy", v.getInventoryPolicy());
            vm.put("requires_shipping", v.getRequiresShipping());
            vm.put("taxable", v.getTaxable());
            vm.put("barcode", v.getBarcode());
            variantList.add(vm);
        }
        payload.put("variants", variantList);

        List<Map<String, Object>> imageList = new ArrayList<>();
        for (ProductImage img : images) {
            Map<String, Object> im = new LinkedHashMap<>();
            im.put("src", img.getSrc());
            im.put("position", img.getPosition());
            im.put("alt", img.getAltText());
            imageList.add(im);
        }
        payload.put("images", imageList);

        return payload;
    }

    private Map<String, Object> callWorker(String path, Map<String, Object> body) throws IOException {
        // Force HTTP/1.1: java.net.http.HttpClient defaults to HTTP/2 + h2c upgrade,
        // which uvicorn rejects with "Unsupported upgrade request" → drops body.
        HttpClient client = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
        String json = objectMapper.writeValueAsString(body);
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(workerBaseUrl + path))
            .timeout(Duration.ofSeconds(workerTimeoutSeconds))
            .header("Content-Type", "application/json")
            .version(HttpClient.Version.HTTP_1_1)
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();
        HttpResponse<String> resp;
        try {
            resp = client.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IOException("worker call interrupted: " + path, ie);
        }
        if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
            throw new IOException("worker " + path + " returned " + resp.statusCode() + ": " + resp.body());
        }
        return objectMapper.readValue(resp.body(), new TypeReference<Map<String, Object>>() {});
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static String asString(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
