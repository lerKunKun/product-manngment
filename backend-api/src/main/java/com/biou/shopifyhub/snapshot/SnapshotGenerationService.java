package com.biou.shopifyhub.snapshot;

import com.biou.shopifyhub.file.FileService;
import com.biou.shopifyhub.snapshot.entity.ProductSnapshot;
import com.biou.shopifyhub.snapshot.mapper.ProductSnapshotMapper;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
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
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Snapshot generation service (W2-SNAP-04).
 *
 * <p>Pipeline (one product per call):
 * <ol>
 *   <li>Load {@code product_snapshot} row + {@code store} row.
 *   <li>Call worker {@code POST /pull/product} → worker fetches Shopify Admin API + uploads
 *       {@code product.json} + images to R2 under
 *       {@code tenants/{t}/stores/{s}/snapshots/{n}/product/}.
 *   <li>Backend downloads {@code product.json} from R2 → serializes 15-col CSV
 *       (W2-SNAP-04 minimal subset) → uploads {@code snapshot.csv} alongside.
 *   <li>Update DB row to SUCCESS with csv/json keys + total_bytes; on any failure update to
 *       FAILED with truncated error_message. Never throws back to the consumer.
 * </ol>
 */
@Service
public class SnapshotGenerationService {

    private static final Logger log = LoggerFactory.getLogger(SnapshotGenerationService.class);
    private static final int MAX_ERR_LEN = 1000;

    private final ProductSnapshotMapper snapshotMapper;
    private final StoreMapper storeMapper;
    private final FileService fileService;
    private final ObjectMapper objectMapper;

    @Value("${shopify.worker.base-url:http://localhost:8765}")
    private String workerBaseUrl;

    @Value("${shopify.worker.call-timeout-seconds:120}")
    private long workerTimeoutSeconds;

    @Value("${shopify.worker.token:}")
    private String workerToken;

    public SnapshotGenerationService(ProductSnapshotMapper snapshotMapper,
                                     StoreMapper storeMapper,
                                     FileService fileService,
                                     ObjectMapper objectMapper) {
        this.snapshotMapper = snapshotMapper;
        this.storeMapper = storeMapper;
        this.fileService = fileService;
        this.objectMapper = objectMapper;
    }

    public void generate(long snapshotId) {
        ProductSnapshot snap = snapshotMapper.selectById(snapshotId);
        if (snap == null) {
            log.warn("snapshot generation: row not found id={}", snapshotId);
            return;
        }
        if (!"RUNNING".equals(snap.getStatus()) && !"PENDING".equals(snap.getStatus())) {
            log.info("snapshot generation: status={} skipping id={}", snap.getStatus(), snapshotId);
            return;
        }
        // Defensive: consumer should already have flipped to RUNNING.
        if ("PENDING".equals(snap.getStatus())) {
            snap.setStatus("RUNNING");
            if (snap.getStartedAt() == null) {
                snap.setStartedAt(LocalDateTime.now());
            }
            snapshotMapper.updateById(snap);
        } else if (snap.getStartedAt() == null) {
            // Already RUNNING but startedAt missing (e.g., row created before V11). Backfill.
            snap.setStartedAt(LocalDateTime.now());
            snapshotMapper.updateById(snap);
        }

        try {
            Store store = storeMapper.selectById(snap.getStoreId());
            if (store == null) {
                throw new IllegalStateException("store not found: id=" + snap.getStoreId());
            }

            long productId = parseProductId(snap.getProductExternalId());

            Map<String, Object> reqBody = new LinkedHashMap<>();
            reqBody.put("shop_domain", store.getMyshopifyDomain());
            reqBody.put("tenant_id", snap.getTenantId());
            reqBody.put("store_id", snap.getStoreId());
            reqBody.put("snapshot_id", snap.getId());
            reqBody.put("product_id", productId);

            Map<String, Object> resp = callWorker("/pull/product", reqBody);

            String r2Prefix = asString(resp.get("r2_prefix"));
            String manifestKey = asString(resp.get("manifest_key"));
            long workerTotalBytes = asLong(resp.get("total_bytes"));
            if (r2Prefix == null || manifestKey == null) {
                throw new IOException("worker response missing r2_prefix/manifest_key: " + resp);
            }

            // Pull product.json from R2 (worker uploaded it under the same prefix).
            String productJsonKey = r2Prefix + "product.json";
            byte[] productJson = fileService.downloadBytes(productJsonKey);
            JsonNode product = objectMapper.readTree(productJson);

            // Serialize 15-col CSV from product JSON; upload alongside.
            byte[] csvBytes = ShopifyJsonCsvWriter.write(product);
            String csvKey = r2Prefix + "snapshot.csv";
            fileService.uploadBytes(csvKey, csvBytes, "text/csv; charset=utf-8");

            snap.setStatus("SUCCESS");
            snap.setCompletedAt(LocalDateTime.now());
            snap.setCsvR2Key(csvKey);
            snap.setJsonR2Key(manifestKey);
            snap.setTotalBytes(workerTotalBytes + (long) csvBytes.length);
            snap.setErrorMessage(null);
            snapshotMapper.updateById(snap);
            log.info("snapshot SUCCESS id={} csvKey={} csvBytes={} workerBytes={}",
                snapshotId, csvKey, csvBytes.length, workerTotalBytes);
        } catch (Exception e) {
            log.error("snapshot generation FAILED id={} err={}", snapshotId, e.getMessage(), e);
            try {
                snap.setStatus("FAILED");
                snap.setCompletedAt(LocalDateTime.now());
                snap.setErrorMessage(truncate(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(),
                    MAX_ERR_LEN));
                snapshotMapper.updateById(snap);
            } catch (Exception markErr) {
                log.error("snapshot generation: failed to mark FAILED id={} err={}",
                    snapshotId, markErr.getMessage(), markErr);
            }
        }
    }

    private Map<String, Object> callWorker(String path, Map<String, Object> body) throws IOException {
        // Force HTTP/1.1: java.net.http.HttpClient defaults to HTTP/2 + h2c upgrade headers,
        // which uvicorn rejects with "Unsupported upgrade request" → drops the body.
        HttpClient client = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
        String json = objectMapper.writeValueAsString(body);
        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create(workerBaseUrl + path))
            .timeout(Duration.ofSeconds(workerTimeoutSeconds))
            .header("Content-Type", "application/json")
            .version(HttpClient.Version.HTTP_1_1)
            .POST(HttpRequest.BodyPublishers.ofString(json));
        if (workerToken != null && !workerToken.isBlank()) {
            reqBuilder.header("X-Worker-Token", workerToken.trim());
        }
        HttpRequest req = reqBuilder.build();
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

    private static long parseProductId(String s) {
        if (s == null || s.isBlank()) {
            throw new IllegalArgumentException("productExternalId is null/blank");
        }
        // Shopify product ids may be plain numeric or "gid://shopify/Product/12345"
        String last = s.contains("/") ? s.substring(s.lastIndexOf('/') + 1) : s;
        try {
            return Long.parseLong(last.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("productExternalId not numeric: " + s);
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static String asString(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static long asLong(Object o) {
        if (o == null) return 0L;
        if (o instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(String.valueOf(o));
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
