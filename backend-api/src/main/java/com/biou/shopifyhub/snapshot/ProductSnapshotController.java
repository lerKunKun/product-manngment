package com.biou.shopifyhub.snapshot;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.file.FileService;
import com.biou.shopifyhub.push.entity.StoreProduct;
import com.biou.shopifyhub.push.mapper.StoreProductMapper;
import com.biou.shopifyhub.snapshot.entity.ProductInventoryHistory;
import com.biou.shopifyhub.snapshot.entity.ProductPriceHistory;
import com.biou.shopifyhub.snapshot.entity.ProductSnapshot;
import com.biou.shopifyhub.snapshot.mapper.ProductInventoryHistoryMapper;
import com.biou.shopifyhub.snapshot.mapper.ProductPriceHistoryMapper;
import com.biou.shopifyhub.snapshot.mapper.ProductSnapshotMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 产品快照查询 + 手动触发接口（W2-SNAP-06）。
 *
 * <p>非阻塞约束：表为空 → list 返 records:[]；详情找不到 → snapshot:null + 空 history。
 * 手动触发不依赖 store 校验（只插 PENDING 行 + 入队 MQ；store 缺失会在 consumer 落地为 FAILED）。
 */
@RestController
@RequestMapping("/product-snapshot")
public class ProductSnapshotController {

    private static final Logger log = LoggerFactory.getLogger(ProductSnapshotController.class);

    private final ProductSnapshotMapper snapshotMapper;
    private final ProductPriceHistoryMapper priceHistoryMapper;
    private final ProductInventoryHistoryMapper inventoryHistoryMapper;
    private final SnapshotDebounceService debounceService;
    private final FileService fileService;
    private final ObjectMapper objectMapper;
    private final StoreProductMapper storeProductMapper;

    public ProductSnapshotController(ProductSnapshotMapper snapshotMapper,
                                     ProductPriceHistoryMapper priceHistoryMapper,
                                     ProductInventoryHistoryMapper inventoryHistoryMapper,
                                     SnapshotDebounceService debounceService,
                                     FileService fileService,
                                     ObjectMapper objectMapper,
                                     StoreProductMapper storeProductMapper) {
        this.snapshotMapper = snapshotMapper;
        this.priceHistoryMapper = priceHistoryMapper;
        this.inventoryHistoryMapper = inventoryHistoryMapper;
        this.debounceService = debounceService;
        this.fileService = fileService;
        this.objectMapper = objectMapper;
        this.storeProductMapper = storeProductMapper;
    }

    /**
     * 反查平台内部 product.id：snapshot 行只带 Shopify 的 product_external_id，
     * 但 product_snapshot.product_id 列需要回填到本平台的 product 表 id 上，
     * 方便后续历史/产品维度的查询走 product_id 索引。
     * 通过 store_product 映射表（push 时建立）反查；映射不存在时返 null。
     */
    private Long resolvePlatformProductId(Long storeId, String productExternalId) {
        if (storeId == null || productExternalId == null) return null;
        StoreProduct sp = storeProductMapper.selectOne(
            new QueryWrapper<StoreProduct>()
                .eq("store_id", storeId)
                .eq("shopify_product_id", productExternalId)
                .last("LIMIT 1")
        );
        return sp == null ? null : sp.getProductId();
    }

    @GetMapping
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public Result<Map<String, Object>> list(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) Long storeId,
        @RequestParam(required = false) String productExternalId,
        @RequestParam(required = false) String status
    ) {
        LambdaQueryWrapper<ProductSnapshot> q = new LambdaQueryWrapper<>();
        if (storeId != null) q.eq(ProductSnapshot::getStoreId, storeId);
        if (productExternalId != null && !productExternalId.isBlank()) q.eq(ProductSnapshot::getProductExternalId, productExternalId);
        if (status != null && !status.isBlank()) q.eq(ProductSnapshot::getStatus, status);
        q.orderByDesc(ProductSnapshot::getId);

        Page<ProductSnapshot> p = snapshotMapper.selectPage(new Page<>(page, size), q);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("records", p.getRecords());
        resp.put("total", p.getTotal());
        resp.put("pageNo", p.getCurrent());
        resp.put("pageSize", p.getSize());
        return Result.ok(resp);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public Result<Map<String, Object>> detail(@PathVariable Long id) {
        ProductSnapshot snap = snapshotMapper.selectById(id);
        Map<String, Object> resp = new LinkedHashMap<>();
        if (snap == null) {
            resp.put("snapshot", null);
            resp.put("priceHistory", List.of());
            resp.put("inventoryHistory", List.of());
            return Result.ok(resp);
        }

        LambdaQueryWrapper<ProductPriceHistory> pq = new LambdaQueryWrapper<>();
        pq.eq(ProductPriceHistory::getStoreId, snap.getStoreId())
          .eq(ProductPriceHistory::getProductExternalId, snap.getProductExternalId())
          .orderByDesc(ProductPriceHistory::getChangedAt)
          .last("LIMIT 10");
        List<ProductPriceHistory> priceHistory = priceHistoryMapper.selectList(pq);

        LambdaQueryWrapper<ProductInventoryHistory> iq = new LambdaQueryWrapper<>();
        iq.eq(ProductInventoryHistory::getStoreId, snap.getStoreId())
          .eq(ProductInventoryHistory::getProductExternalId, snap.getProductExternalId())
          .orderByDesc(ProductInventoryHistory::getChangedAt)
          .last("LIMIT 10");
        List<ProductInventoryHistory> inventoryHistory = inventoryHistoryMapper.selectList(iq);

        // Flatten snapshot row + history alongside
        resp.put("id", snap.getId());
        resp.put("tenantId", snap.getTenantId());
        resp.put("storeId", snap.getStoreId());
        resp.put("productExternalId", snap.getProductExternalId());
        resp.put("productId", snap.getProductId());
        resp.put("triggerEvent", snap.getTriggerEvent());
        resp.put("status", snap.getStatus());
        resp.put("csvR2Key", snap.getCsvR2Key());
        resp.put("jsonR2Key", snap.getJsonR2Key());
        resp.put("diffSummaryJson", snap.getDiffSummaryJson());
        resp.put("totalBytes", snap.getTotalBytes());
        resp.put("errorMessage", snap.getErrorMessage());
        resp.put("createdAt", snap.getCreatedAt());
        resp.put("completedAt", snap.getCompletedAt());
        resp.put("priceHistory", priceHistory);
        resp.put("inventoryHistory", inventoryHistory);
        return Result.ok(resp);
    }

    @GetMapping("/{id}/manifest")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public Result<Map<String, Object>> manifest(@PathVariable Long id) {
        ProductSnapshot snap = snapshotMapper.selectById(id);
        if (snap == null) {
            return Result.error(404, "snapshot not found: " + id);
        }
        String key = snap.getJsonR2Key();
        if (key == null || key.isBlank()) {
            return Result.error(404, "snapshot has no jsonR2Key yet (status=" + snap.getStatus() + ")");
        }
        try {
            byte[] data = fileService.downloadBytes(key);
            Map<String, Object> parsed = objectMapper.readValue(data, new TypeReference<Map<String, Object>>() {});
            return Result.ok(parsed);
        } catch (Exception e) {
            log.warn("product-snapshot manifest load failed id={} key={} err={}", id, key, e.getMessage());
            return Result.error(500, "manifest load failed: " + e.getMessage());
        }
    }

    @GetMapping("/{id}/csv")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public ResponseEntity<byte[]> csv(@PathVariable Long id) {
        ProductSnapshot snap = snapshotMapper.selectById(id);
        if (snap == null) {
            return ResponseEntity.notFound().build();
        }
        String key = snap.getCsvR2Key();
        if (key == null || key.isBlank()) {
            return ResponseEntity.status(404).body(("snapshot has no csvR2Key yet (status=" + snap.getStatus() + ")").getBytes());
        }
        try {
            byte[] data = fileService.downloadBytes(key);
            String filename = "product-snapshot-" + id + ".csv";
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.parseMediaType("text/csv; charset=utf-8"));
            headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"");
            return ResponseEntity.ok().headers(headers).body(data);
        } catch (Exception e) {
            log.warn("product-snapshot csv load failed id={} key={} err={}", id, key, e.getMessage());
            return ResponseEntity.status(500).body(("csv load failed: " + e.getMessage()).getBytes());
        }
    }

    @PostMapping("/manual")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:READ')")
    public Result<Map<String, Object>> manual(@RequestBody ManualReq req) {
        if (req == null || req.storeId == null || req.productExternalId == null || req.productExternalId.isBlank()) {
            return Result.error(400, "storeId + productExternalId required");
        }
        long tenantId = req.tenantId == null ? 1L : req.tenantId;

        String externalId = req.productExternalId.trim();
        ProductSnapshot snap = new ProductSnapshot();
        snap.setTenantId(tenantId);
        snap.setStoreId(req.storeId);
        snap.setProductExternalId(externalId);
        snap.setProductId(resolvePlatformProductId(req.storeId, externalId));
        snap.setTriggerEvent("MANUAL");
        snap.setStatus("PENDING");
        snap.setTotalBytes(0L);
        snap.setCreatedAt(LocalDateTime.now());
        snapshotMapper.insert(snap);
        long snapshotId = snap.getId();

        boolean queued;
        try {
            queued = debounceService.tryEnqueue(snapshotId, tenantId, req.storeId, req.productExternalId.trim());
        } catch (Exception e) {
            log.warn("manual snapshot enqueue threw id={} err={}", snapshotId, e.getMessage());
            queued = false;
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("snapshotId", snapshotId);
        resp.put("queued", queued);
        if (!queued) {
            // The leader's snapshotId is in Redis; we don't read it back here (best-effort).
            // Frontend simply shows "5 分钟内已有快照任务"; no need to surface internal id.
            resp.put("message", "duplicate within debounce window or MQ unavailable");
        }
        return Result.ok(resp);
    }

    public static class ManualReq {
        public Long storeId;
        public String productExternalId;
        public Long tenantId;
    }
}
