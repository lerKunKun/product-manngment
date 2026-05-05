package com.biou.shopifyhub.asset.sync;

import com.biou.shopifyhub.asset.entity.AssetSnapshot;
import com.biou.shopifyhub.asset.mapper.AssetSnapshotMapper;
import com.biou.shopifyhub.store.ShopifyApiClient;
import com.biou.shopifyhub.store.StoreService;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 全店静默同步消费者（AS1-03 + AS3-05）。
 *
 * <p>从 {@link AssetSyncMqConfig#FULL_STORE_QUEUE} 拿到消息后，串行调
 * worker {@code POST /pull/theme} → {@code /pull/product} →
 * {@code /pull/files} → {@code /pull/shop_settings} →
 * {@code /pull/metafields}。后三段在 AS3 加入；菜单 / 政策 / 集合本波仍不做。
 * 聚合规则：
 * <ul>
 *   <li>全部子任务成功 → SUCCESS</li>
 *   <li>全部子任务失败 → FAILED</li>
 *   <li>部分成功部分失败 → PARTIAL（V35 新加）</li>
 * </ul>
 * 累计 file_count / total_bytes 写回 asset_snapshot。
 *
 * <p>worker 调用模式参考 {@code PushService.callWorker}：HTTP/1.1 + 显式 timeout +
 * IOException 收尾。失败永不 requeue（at-most-once），错误信息写回 error_message。
 */
@Component
public class SyncConsumer {

    private static final Logger log = LoggerFactory.getLogger(SyncConsumer.class);
    private static final int MAX_ERR_LEN = 1000;

    private final AssetSnapshotMapper snapshotMapper;
    private final StoreMapper storeMapper;
    private final StoreService storeService;
    private final ShopifyApiClient shopifyApiClient;
    private final ObjectMapper objectMapper;

    @Value("${shopify.worker.base-url:http://localhost:8765}")
    private String workerBaseUrl;

    @Value("${shopify.worker.call-timeout-seconds:120}")
    private long workerTimeoutSeconds;

    /** 单店全量同步首版上限：避免巨型店打爆 worker / Shopify 速率（与 ShopifyApiClient 翻页 8 页对齐）。 */
    @Value("${shopify.asset-sync.max-products:200}")
    private int maxProducts;

    public SyncConsumer(AssetSnapshotMapper snapshotMapper,
                        StoreMapper storeMapper,
                        StoreService storeService,
                        ShopifyApiClient shopifyApiClient,
                        ObjectMapper objectMapper) {
        this.snapshotMapper = snapshotMapper;
        this.storeMapper = storeMapper;
        this.storeService = storeService;
        this.shopifyApiClient = shopifyApiClient;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = AssetSyncMqConfig.FULL_STORE_QUEUE)
    public void onMessage(@Payload Map<String, Object> payload,
                          Channel channel,
                          @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag) {
        Long snapshotId = null;
        try {
            Object idObj = payload.get("snapshotId");
            if (!(idObj instanceof Number)) {
                log.warn("[asset-sync] missing/invalid snapshotId payload={}", payload);
                return;
            }
            snapshotId = ((Number) idObj).longValue();
            handle(snapshotId);
        } catch (Exception e) {
            log.error("[asset-sync] consumer error payload={} snapshotId={} err={}",
                payload, snapshotId, e.getMessage(), e);
        } finally {
            try {
                channel.basicAck(deliveryTag, false);
            } catch (Exception ackErr) {
                log.warn("[asset-sync] ack failed tag={} err={}", deliveryTag, ackErr.getMessage());
            }
        }
    }

    /** 实际处理单次 fullStore 同步。异常都写回 FAILED 行，决不抛回 onMessage。 */
    void handle(long snapshotId) {
        AssetSnapshot snap = snapshotMapper.selectById(snapshotId);
        if (snap == null) {
            log.warn("[asset-sync] snapshot not found id={}", snapshotId);
            return;
        }
        if (!"PENDING".equals(snap.getStatus())) {
            log.info("[asset-sync] snapshot not PENDING (status={}) skipping id={}",
                snap.getStatus(), snapshotId);
            return;
        }
        Store store = storeMapper.selectById(snap.getStoreId());
        if (store == null) {
            markFailed(snap, "store not found: id=" + snap.getStoreId());
            return;
        }

        snap.setStatus("RUNNING");
        snap.setStartedAt(LocalDateTime.now());
        snapshotMapper.updateById(snap);

        String accessToken = null;
        if (store.getEncryptedAccessToken() != null && !store.getEncryptedAccessToken().isBlank()) {
            try {
                accessToken = storeService.decryptToken(store);
            } catch (Exception e) {
                log.warn("[asset-sync] decryptToken failed storeId={} err={}",
                    store.getId(), e.getMessage());
            }
        }

        int totalSubtasks = 0;
        int successSubtasks = 0;
        long totalBytes = 0L;
        int totalFiles = 0;
        StringBuilder errors = new StringBuilder();

        // ---- 子任务 1：拉主题（不需要 productId） ----
        totalSubtasks++;
        WorkerOutcome themeOut = pullTheme(store, snap.getId());
        if (themeOut.ok()) {
            successSubtasks++;
            totalBytes += themeOut.totalBytes();
            totalFiles += themeOut.fileCount();
        } else {
            appendError(errors, "theme", themeOut.error());
        }

        // ---- 子任务 2..N：拉产品（每个 product 一次 /pull/product） ----
        // listProductIds 走 Shopify Admin REST 翻页，本身可能失败。失败统计为 1 个子任务失败。
        if (accessToken == null) {
            totalSubtasks++;
            appendError(errors, "product", "no access token (cannot list products)");
        } else {
            ShopifyApiClient.ProductIdsResult listed = shopifyApiClient.listProductIds(
                store.getMyshopifyDomain(), accessToken);
            if (!listed.ok()) {
                totalSubtasks++;
                appendError(errors, "product.list", listed.error());
            } else {
                List<Long> productIds = listed.ids();
                if (productIds.isEmpty()) {
                    log.info("[asset-sync] store has no products, skipping product pulls storeId={}",
                        store.getId());
                } else {
                    int n = Math.min(productIds.size(), maxProducts);
                    log.info("[asset-sync] pulling {} products storeId={} (total={}, capped={})",
                        n, store.getId(), productIds.size(), n < productIds.size());
                    for (int i = 0; i < n; i++) {
                        long pid = productIds.get(i);
                        totalSubtasks++;
                        WorkerOutcome out = pullProduct(store, snap.getId(), pid);
                        if (out.ok()) {
                            successSubtasks++;
                            totalBytes += out.totalBytes();
                            totalFiles += out.fileCount();
                        } else {
                            appendError(errors, "product:" + pid, out.error());
                        }
                    }
                }
            }
        }

        // ---- 子任务 N+1：拉 Files 库（AS3-05） ----
        totalSubtasks++;
        WorkerOutcome filesOut = pullFiles(store, snap.getId());
        if (filesOut.ok()) {
            successSubtasks++;
            totalBytes += filesOut.totalBytes();
            totalFiles += filesOut.fileCount();
        } else {
            appendError(errors, "files", filesOut.error());
        }

        // ---- 子任务 N+2：拉店铺设置（AS3-05） ----
        totalSubtasks++;
        WorkerOutcome settingsOut = pullShopSettings(store, snap.getId());
        if (settingsOut.ok()) {
            successSubtasks++;
            totalBytes += settingsOut.totalBytes();
            totalFiles += settingsOut.fileCount();
        } else {
            appendError(errors, "shop_settings", settingsOut.error());
        }

        // ---- 子任务 N+3：拉店铺级 metafields（AS3-05） ----
        totalSubtasks++;
        WorkerOutcome metaOut = pullMetafields(store, snap.getId());
        if (metaOut.ok()) {
            successSubtasks++;
            totalBytes += metaOut.totalBytes();
            totalFiles += metaOut.fileCount();
        } else {
            appendError(errors, "metafields", metaOut.error());
        }

        // ---- 终态聚合 ----
        String finalStatus;
        if (totalSubtasks == 0 || successSubtasks == totalSubtasks) {
            finalStatus = "SUCCESS";
        } else if (successSubtasks == 0) {
            finalStatus = "FAILED";
        } else {
            finalStatus = "PARTIAL";
        }
        snap.setStatus(finalStatus);
        snap.setFileCount(totalFiles);
        snap.setTotalBytes(totalBytes);
        snap.setCompletedAt(LocalDateTime.now());
        if (errors.length() > 0) {
            snap.setErrorMessage(truncate(errors.toString(), MAX_ERR_LEN));
        } else {
            snap.setErrorMessage(null);
        }
        snapshotMapper.updateById(snap);
        log.info("[asset-sync] fullStore done snapshotId={} storeId={} status={} ok={}/{} files={} bytes={}",
            snapshotId, store.getId(), finalStatus, successSubtasks, totalSubtasks, totalFiles, totalBytes);
    }

    private WorkerOutcome pullTheme(Store store, long snapshotId) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("shop_domain", store.getMyshopifyDomain());
        req.put("tenant_id", store.getTenantId());
        req.put("store_id", store.getId());
        req.put("snapshot_id", snapshotId);
        return callWorkerJson("/pull/theme", req);
    }

    private WorkerOutcome pullProduct(Store store, long snapshotId, long productId) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("shop_domain", store.getMyshopifyDomain());
        req.put("tenant_id", store.getTenantId());
        req.put("store_id", store.getId());
        req.put("snapshot_id", snapshotId);
        req.put("product_id", productId);
        return callWorkerJson("/pull/product", req);
    }

    /** AS3-05：调 worker {@code POST /pull/files}（Shopify Files 库）。 */
    private WorkerOutcome pullFiles(Store store, long snapshotId) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("shop_domain", store.getMyshopifyDomain());
        req.put("tenant_id", store.getTenantId());
        req.put("store_id", store.getId());
        req.put("snapshot_id", snapshotId);
        return callWorkerJson("/pull/files", req);
    }

    /** AS3-05：调 worker {@code POST /pull/shop_settings}（shop / locations / shipping_zones / markets）。 */
    private WorkerOutcome pullShopSettings(Store store, long snapshotId) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("shop_domain", store.getMyshopifyDomain());
        req.put("tenant_id", store.getTenantId());
        req.put("store_id", store.getId());
        req.put("snapshot_id", snapshotId);
        return callWorkerJson("/pull/shop_settings", req);
    }

    /** AS3-05：调 worker {@code POST /pull/metafields}（SHOP-level metafield definitions + instances）。 */
    private WorkerOutcome pullMetafields(Store store, long snapshotId) {
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("shop_domain", store.getMyshopifyDomain());
        req.put("tenant_id", store.getTenantId());
        req.put("store_id", store.getId());
        req.put("snapshot_id", snapshotId);
        return callWorkerJson("/pull/metafields", req);
    }

    private WorkerOutcome callWorkerJson(String path, Map<String, Object> body) {
        try {
            WorkerResponse wr = callWorker(path, body);
            if (wr.statusCode() < 200 || wr.statusCode() >= 300) {
                return new WorkerOutcome(false, 0, 0L,
                    "worker " + path + " returned " + wr.statusCode() + ": " + snip(wr.body(), 200));
            }
            Map<String, Object> resp = (wr.body() == null || wr.body().isEmpty())
                ? Map.of()
                : objectMapper.readValue(wr.body(), new TypeReference<Map<String, Object>>() {});
            int fileCount = asInt(resp.get("file_count"));
            long totalBytes = asLong(resp.get("total_bytes"));
            return new WorkerOutcome(true, fileCount, totalBytes, null);
        } catch (IOException e) {
            return new WorkerOutcome(false, 0, 0L,
                e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private WorkerResponse callWorker(String path, Map<String, Object> body) throws IOException {
        // HTTP/1.1：与 PushService / SnapshotGenerationService 保持一致——uvicorn 拒收 h2c upgrade。
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
        return new WorkerResponse(resp.statusCode(), resp.body());
    }

    private void markFailed(AssetSnapshot snap, String error) {
        snap.setStatus("FAILED");
        snap.setErrorMessage(truncate(error, MAX_ERR_LEN));
        snap.setCompletedAt(LocalDateTime.now());
        snapshotMapper.updateById(snap);
    }

    private static void appendError(StringBuilder sb, String label, String err) {
        if (sb.length() > 0) sb.append("; ");
        sb.append(label).append(": ").append(err == null ? "(unknown)" : err);
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static String snip(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static int asInt(Object o) {
        if (o == null) return 0;
        if (o instanceof Number n) return n.intValue();
        try { return Integer.parseInt(String.valueOf(o)); } catch (NumberFormatException e) { return 0; }
    }

    private static long asLong(Object o) {
        if (o == null) return 0L;
        if (o instanceof Number n) return n.longValue();
        try { return Long.parseLong(String.valueOf(o)); } catch (NumberFormatException e) { return 0L; }
    }

    private record WorkerResponse(int statusCode, String body) {}

    private record WorkerOutcome(boolean ok, int fileCount, long totalBytes, String error) {}
}
