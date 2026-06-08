package com.biou.shopifyhub.push;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.product.entity.Product;
import com.biou.shopifyhub.product.entity.ProductImage;
import com.biou.shopifyhub.product.entity.ProductMetafield;
import com.biou.shopifyhub.product.entity.ProductVariant;
import com.biou.shopifyhub.product.mapper.ProductImageMapper;
import com.biou.shopifyhub.product.mapper.ProductMapper;
import com.biou.shopifyhub.product.mapper.ProductMetafieldMapper;
import com.biou.shopifyhub.product.mapper.ProductVariantMapper;
import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import com.biou.shopifyhub.push.entity.PushConflict;
import com.biou.shopifyhub.push.entity.StoreProduct;
import com.biou.shopifyhub.push.entity.Task;
import com.biou.shopifyhub.push.mapper.PushConflictMapper;
import com.biou.shopifyhub.push.mapper.StoreProductMapper;
import com.biou.shopifyhub.push.mapper.TaskMapper;
import com.biou.shopifyhub.store.StoreService;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.biou.shopifyhub.template.ReplaceEngine;
import com.biou.shopifyhub.template.RuleSpec;
import com.biou.shopifyhub.template.binding.StoreTemplateBinding;
import com.biou.shopifyhub.template.binding.StoreTemplateBindingService;
import com.biou.shopifyhub.template.entity.BaseTemplateVersion;
import com.biou.shopifyhub.template.mapper.BaseTemplateVersionMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.math.BigDecimal;
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
 * Push orchestration service (W2-PUSH-04).
 *
 * <p>Coordinates a single product push: builds the Shopify payload from our
 * internal {@code product} / {@code product_variant} / {@code product_image}
 * rows, calls the worker {@code POST /push/product}, then persists the
 * outcome in {@code task} / {@code store_product} / {@code push_conflict}.
 *
 * <p>Failure semantics:
 * <ul>
 *   <li>200 + no conflict → task SUCCESS, upsert {@code store_product} with
 *       {@code shopify_product_id}.
 *   <li>200 + conflict (HANDLE_RENAMED) → task PARTIAL, write
 *       {@code push_conflict} PENDING, still upsert {@code store_product}.
 *   <li>422 (validation) → task FAILED + {@code push_conflict} VALIDATION
 *       PENDING.
 *   <li>502 / 503 / timeout / I/O → task FAILED with {@code error_message}.
 * </ul>
 *
 * <p>Day 6 is synchronous: callers receive the persisted task id once the
 * worker returns. W2-PUSH-05 will move long-running pushes to a queue.
 */
@Service
public class PushService {

    private static final Logger log = LoggerFactory.getLogger(PushService.class);
    private static final int MAX_ERR_LEN = 1000;

    private final ProductMapper productMapper;
    private final ProductVariantMapper variantMapper;
    private final ProductImageMapper imageMapper;
    private final ProductMetafieldMapper metafieldMapper;
    private final StoreMapper storeMapper;
    private final StoreService storeService;
    private final StoreProductMapper storeProductMapper;
    private final TaskMapper taskMapper;
    private final PushConflictMapper conflictMapper;
    private final ObjectMapper objectMapper;
    private final NotificationDispatcher notificationDispatcher;
    private final StoreTemplateBindingService bindingService;
    private final BaseTemplateVersionMapper versionMapper;

    /**
     * Default admin user id used as the recipient of {@code PRODUCT_PUSH_FAIL}
     * notifications when no triggeredBy is supplied (W2-PUSH-07). Mirrors the
     * pattern used by {@code StoreTokenScheduler} (broadcast to admin id=1).
     */
    @Value("${shopify.push.fail-notify-fallback-user-id:1}")
    private long failNotifyFallbackUserId;

    @Value("${shopify.worker.base-url:http://localhost:8765}")
    private String workerBaseUrl;

    @Value("${shopify.worker.call-timeout-seconds:120}")
    private long workerTimeoutSeconds;

    @Value("${shopify.worker.token:}")
    private String workerToken;

    public PushService(ProductMapper productMapper,
                       ProductVariantMapper variantMapper,
                       ProductImageMapper imageMapper,
                       ProductMetafieldMapper metafieldMapper,
                       StoreMapper storeMapper,
                       StoreService storeService,
                       StoreProductMapper storeProductMapper,
                       TaskMapper taskMapper,
                       PushConflictMapper conflictMapper,
                       ObjectMapper objectMapper,
                       NotificationDispatcher notificationDispatcher,
                       StoreTemplateBindingService bindingService,
                       BaseTemplateVersionMapper versionMapper) {
        this.productMapper = productMapper;
        this.variantMapper = variantMapper;
        this.imageMapper = imageMapper;
        this.metafieldMapper = metafieldMapper;
        this.storeMapper = storeMapper;
        this.storeService = storeService;
        this.storeProductMapper = storeProductMapper;
        this.taskMapper = taskMapper;
        this.conflictMapper = conflictMapper;
        this.objectMapper = objectMapper;
        this.notificationDispatcher = notificationDispatcher;
        this.bindingService = bindingService;
        this.versionMapper = versionMapper;
    }

    /**
     * Push our internal product to a Shopify store. Synchronous: returns the
     * task id only after the worker call has returned (or failed).
     */
    public Long push(long productId, long storeId, Long triggeredBy) {
        return push(productId, storeId, triggeredBy, null);
    }

    /**
     * Push variant that lets the caller override the {@code base_template_version}
     * for this single push (Track AS5). Pass {@code null} to fall back to the
     * store's persisted binding (or no binding → no replacement).
     */
    public Long push(long productId, long storeId, Long triggeredBy, Long templateVersionOverrideId) {
        Product product = productMapper.selectById(productId);
        if (product == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "product not found: " + productId);
        }
        Store store = storeMapper.selectById(storeId);
        if (store == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "store not found: " + storeId);
        }

        List<ProductVariant> variants = variantMapper.selectList(
            new QueryWrapper<ProductVariant>().eq("product_id", productId).orderByAsc("position")
        );
        List<ProductImage> images = imageMapper.selectList(
            new QueryWrapper<ProductImage>().eq("product_id", productId).orderByAsc("position")
        );
        // 本地 product_metafield 表是推送的 source-of-truth：由用户在 admin UI（产品详情页 RightPanel
        // 的 MetafieldsCard）手编填入。
        // AS3 worker 的 /pull/metafields 只拉 shop-level 落 R2 快照（不回写本地 product_metafield），
        // 因此 pull 与 push 不构成双向同步；首次推送新产品到新店时，如果用户没在我们这边配过
        // metafield，worker 端 metafieldsSet 调用就空跑，是预期行为而非 bug。
        List<ProductMetafield> metafields = metafieldMapper.selectList(
            new QueryWrapper<ProductMetafield>().eq("product_id", productId)
        );

        // Resolve replace rules from binding (or override). If override is set
        // we IGNORE the binding's custom rules and use ONLY the override
        // version's defaults — semantically "this push pretends store is bound
        // to that version, no per-store custom".
        ResolvedRules resolved = resolveRulesFor(storeId, templateVersionOverrideId);

        Map<String, Integer> ruleHits = new LinkedHashMap<>();
        Map<String, Object> productPayload = buildProductPayload(
            product, variants, images, metafields, resolved.rules(), ruleHits);

        Map<String, Object> reqBody = new LinkedHashMap<>();
        reqBody.put("shop_domain", store.getMyshopifyDomain());
        reqBody.put("tenant_id", store.getTenantId());
        reqBody.put("store_id", storeId);
        // task_id is filled in after we have a row; placeholder for now.
        reqBody.put("task_id", 0L);
        reqBody.put("product_payload", productPayload);
        // Decrypt access token only when we actually have an encrypted blob;
        // worker will fall back to the shopify CLI cache otherwise.
        String accessToken = null;
        if (store.getEncryptedAccessToken() != null && !store.getEncryptedAccessToken().isBlank()) {
            try {
                accessToken = storeService.decryptToken(store);
            } catch (Exception e) {
                log.warn("[push] decryptToken failed storeId={} err={}", storeId, e.getMessage());
                // Fall through with null token; worker tries CLI cache.
            }
        }
        if (accessToken != null) {
            reqBody.put("access_token", accessToken);
        }

        // 1) Persist task as PENDING. We need the task id BEFORE calling
        //    worker so any upstream log / trace can be correlated.
        Task task = new Task();
        task.setTenantId(store.getTenantId());
        task.setType("PRODUCT_PUSH");
        task.setStatus("PENDING");
        task.setStoreId(storeId);
        task.setTriggeredBy(triggeredBy);
        try {
            // payload_json reflects the worker request (sans access_token), plus
            // productId at top level so TaskController can find the source row
            // without parsing nested JSON or reverse-querying store_product.
            // Replace-rule hits are recorded for downstream visibility (no
            // dedicated column yet — TODO: add result_extra_json column to task).
            Map<String, Object> payloadForLog = new LinkedHashMap<>();
            payloadForLog.put("productId", productId);
            payloadForLog.putAll(reqBody);
            payloadForLog.remove("access_token");
            if (resolved.versionId() != null) {
                payloadForLog.put("templateVersionId", resolved.versionId());
            }
            if (!ruleHits.isEmpty()) {
                payloadForLog.put("replaceRuleHits", ruleHits);
            }
            task.setPayloadJson(objectMapper.writeValueAsString(payloadForLog));
        } catch (Exception e) {
            task.setPayloadJson("{}");
        }
        if (resolved.versionId() != null || !ruleHits.isEmpty()) {
            log.info("[push] productId={} storeId={} templateVersionId={} replaceRuleHits={}",
                productId, storeId, resolved.versionId(), ruleHits);
        }
        taskMapper.insert(task);
        Long taskId = task.getId();
        reqBody.put("task_id", taskId);

        task.setStatus("RUNNING");
        task.setStartedAt(LocalDateTime.now());
        taskMapper.updateById(task);

        // 2) Call worker.
        Map<String, Object> resp;
        Integer workerStatus = null;
        String workerBody = null;
        try {
            WorkerResponse wr = callWorker("/push/product", reqBody);
            workerStatus = wr.statusCode();
            workerBody = wr.body();
            resp = (wr.body() == null || wr.body().isEmpty())
                ? Map.of()
                : objectMapper.readValue(wr.body(), new TypeReference<Map<String, Object>>() {});
        } catch (IOException e) {
            log.error("[push] worker call FAILED productId={} storeId={} err={}",
                productId, storeId, e.getMessage(), e);
            task.setStatus("FAILED");
            task.setErrorMessage(truncate(e.getMessage(), MAX_ERR_LEN));
            task.setCompletedAt(LocalDateTime.now());
            taskMapper.updateById(task);
            notifyPushFail(task, productId, storeId, triggeredBy);
            return taskId;
        }

        // 3) Branch on worker status.
        if (workerStatus != null && workerStatus == 422) {
            // Validation conflict — worker returned conflict={"type":"VALIDATION", ...}
            // body shape: {"detail": {... task_id/error/conflict ...}} (FastAPI HTTPException)
            String errMessage = "shopify validation rejected";
            Map<String, Object> detail = extractDetail(resp);
            if (detail != null && detail.get("error") != null) {
                errMessage = String.valueOf(detail.get("error"));
            }
            String conflictDetailJson = "{}";
            try {
                Object conflict = detail == null ? null : detail.get("conflict");
                conflictDetailJson = objectMapper.writeValueAsString(conflict == null ? Map.of() : conflict);
            } catch (Exception ignored) {
            }
            persistConflict(taskId, productId, storeId, "VALIDATION", conflictDetailJson);
            task.setStatus("FAILED");
            task.setErrorMessage(truncate(errMessage, MAX_ERR_LEN));
            task.setResultJson(workerBody);
            task.setCompletedAt(LocalDateTime.now());
            taskMapper.updateById(task);
            notifyPushFail(task, productId, storeId, triggeredBy);
            return taskId;
        }
        if (workerStatus == null || workerStatus < 200 || workerStatus >= 300) {
            String msg = "worker returned " + workerStatus + ": " + workerBody;
            task.setStatus("FAILED");
            task.setErrorMessage(truncate(msg, MAX_ERR_LEN));
            task.setResultJson(workerBody);
            task.setCompletedAt(LocalDateTime.now());
            taskMapper.updateById(task);
            notifyPushFail(task, productId, storeId, triggeredBy);
            return taskId;
        }

        // 200 OK: parse worker payload.
        String shopifyProductId = asString(resp.get("shopify_product_id"));
        String shopifyHandle = asString(resp.get("shopify_handle"));
        Object conflictObj = resp.get("conflict");
        boolean hasConflict = (conflictObj instanceof Map<?, ?> m && !m.isEmpty());

        // 4) Upsert store_product row.
        upsertStoreProduct(store.getTenantId(), storeId, productId, shopifyProductId, shopifyHandle, taskId);

        // 5) Update task.
        try {
            task.setResultJson(objectMapper.writeValueAsString(resp));
        } catch (Exception ignored) {
            task.setResultJson(workerBody);
        }
        task.setCompletedAt(LocalDateTime.now());
        if (hasConflict) {
            String conflictType = "OTHER";
            String conflictDetailJson = "{}";
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> cm = (Map<String, Object>) conflictObj;
                if (cm.get("type") != null) {
                    String raw = String.valueOf(cm.get("type"));
                    conflictType = mapConflictType(raw);
                }
                conflictDetailJson = objectMapper.writeValueAsString(cm);
            } catch (Exception ignored) {
            }
            persistConflict(taskId, productId, storeId, conflictType, conflictDetailJson);
            task.setStatus("PARTIAL");
        } else {
            task.setStatus("SUCCESS");
        }
        taskMapper.updateById(task);
        log.info("[push] done taskId={} productId={} storeId={} status={} shopifyProductId={}",
            taskId, productId, storeId, task.getStatus(), shopifyProductId);
        return taskId;
    }

    /**
     * Same as {@link #push(long, long, Long)} but reserved for the future
     * async path (W2-PUSH-05). For Day 6 we just delegate synchronously so
     * callers can switch later without changing the entry-point signature.
     */
    public Long pushAsync(long productId, long storeId, Long triggeredBy) {
        return push(productId, storeId, triggeredBy);
    }

    public Long pushAsync(long productId, long storeId, Long triggeredBy, Long templateVersionOverrideId) {
        return push(productId, storeId, triggeredBy, templateVersionOverrideId);
    }

    /**
     * Batch push multiple products to one store (W2-PUSH-05).
     *
     * <p>Day 7 implementation: synchronous loop over {@link #push}. A parent
     * task row of type=PRODUCT_PUSH (status RUNNING→SUCCESS/PARTIAL) is
     * inserted up front; each per-product sub-task is back-linked via
     * {@code parent_task_id}. The HTTP request blocks until all sub-pushes
     * have completed — see Wave2-配置占位.md §14 for the limitation note and
     * the future async/queue plan.
     *
     * <p>Counts reported in the result reflect the terminal status of each
     * sub-task ({@code SUCCESS} / {@code FAILED} / {@code PARTIAL}). The
     * parent's final status is {@code PARTIAL} when any sub-task FAILED or
     * PARTIAL, otherwise {@code SUCCESS}.
     */
    public BatchResult pushBatch(List<Long> productIds, long storeId, Long triggeredBy) {
        return pushBatch(productIds, storeId, triggeredBy, null);
    }

    public BatchResult pushBatch(List<Long> productIds, long storeId, Long triggeredBy, Long templateVersionOverrideId) {
        if (productIds == null || productIds.isEmpty()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "productIds must not be empty");
        }
        Store store = storeMapper.selectById(storeId);
        if (store == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "store not found: " + storeId);
        }

        // 1) Insert parent task (RUNNING).
        Task parent = new Task();
        parent.setTenantId(store.getTenantId());
        parent.setType("PRODUCT_PUSH");
        parent.setStatus("RUNNING");
        parent.setStoreId(storeId);
        parent.setTriggeredBy(triggeredBy);
        try {
            Map<String, Object> parentPayload = new LinkedHashMap<>();
            parentPayload.put("productIds", productIds);
            parentPayload.put("storeId", storeId);
            parentPayload.put("batch", true);
            parent.setPayloadJson(objectMapper.writeValueAsString(parentPayload));
        } catch (Exception e) {
            parent.setPayloadJson("{}");
        }
        parent.setStartedAt(LocalDateTime.now());
        taskMapper.insert(parent);
        Long parentTaskId = parent.getId();

        // 2) Loop over sub-pushes, back-link via parent_task_id.
        List<Long> subTaskIds = new ArrayList<>(productIds.size());
        int success = 0, failed = 0, partial = 0;
        for (Long pid : productIds) {
            if (pid == null) continue;
            Long subId;
            try {
                subId = push(pid, storeId, triggeredBy, templateVersionOverrideId);
            } catch (Exception e) {
                // Validation failure (e.g. product not found) before task row was inserted.
                log.warn("[push-batch] sub push threw productId={} storeId={} err={}",
                    pid, storeId, e.getMessage());
                failed++;
                continue;
            }
            if (subId == null) continue;
            subTaskIds.add(subId);
            Task sub = taskMapper.selectById(subId);
            if (sub == null) continue;
            sub.setParentTaskId(parentTaskId);
            taskMapper.updateById(sub);
            switch (sub.getStatus() == null ? "" : sub.getStatus()) {
                case "SUCCESS" -> success++;
                case "FAILED" -> failed++;
                case "PARTIAL" -> partial++;
                default -> { /* ignore PENDING/RUNNING (shouldn't happen post-push) */ }
            }
        }

        // 3) Finalize parent status.
        parent.setStatus((failed > 0 || partial > 0) ? "PARTIAL" : "SUCCESS");
        parent.setCompletedAt(LocalDateTime.now());
        try {
            Map<String, Object> resultPayload = new LinkedHashMap<>();
            resultPayload.put("subTaskIds", subTaskIds);
            resultPayload.put("success", success);
            resultPayload.put("failed", failed);
            resultPayload.put("partial", partial);
            parent.setResultJson(objectMapper.writeValueAsString(resultPayload));
        } catch (Exception ignored) {
        }
        taskMapper.updateById(parent);
        log.info("[push-batch] done parentTaskId={} storeId={} total={} success={} failed={} partial={}",
            parentTaskId, storeId, productIds.size(), success, failed, partial);
        return new BatchResult(parentTaskId, subTaskIds, success, failed, partial);
    }

    /**
     * Result of a batch push call: the parent task id, the list of sub-task
     * ids in input order, and the per-status counters.
     */
    public record BatchResult(Long parentTaskId, List<Long> subTaskIds, int success, int failed, int partial) {}

    // ---------------------------------------------------------------- helpers

    /**
     * Build the worker-facing product payload.
     *
     * <p>Track AS5: applies the store-binding's merged replace rules to the
     * text fields ({@code body_html}, {@code seo_description},
     * {@code metafields[].value}), accumulates per-rule hit counts into
     * {@code ruleHits}, transmits {@code template_suffix} when set, and
     * always re-emits the product's persisted metafields so the worker
     * can re-seed them on the target store via GraphQL {@code metafieldsSet}.
     */
    private Map<String, Object> buildProductPayload(Product p,
                                                    List<ProductVariant> variants,
                                                    List<ProductImage> images,
                                                    List<ProductMetafield> metafields,
                                                    Map<String, RuleSpec> rules,
                                                    Map<String, Integer> ruleHits) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", p.getTitle());
        if (p.getHandle() != null) payload.put("handle", p.getHandle());
        if (p.getBodyHtml() != null) {
            payload.put("body_html", ReplaceEngine.applyAccumulating(p.getBodyHtml(), rules, ruleHits));
        }
        if (p.getVendor() != null) payload.put("vendor", p.getVendor());
        if (p.getType() != null) payload.put("product_type", p.getType());
        if (p.getTags() != null) payload.put("tags", p.getTags());
        payload.put("status", p.getStatus() == null ? "active" : p.getStatus());
        if (p.getTemplateSuffix() != null && !p.getTemplateSuffix().isBlank()) {
            payload.put("template_suffix", p.getTemplateSuffix());
        }
        if (p.getSeoDescription() != null) {
            // SEO description rides as a metafield on Shopify (global.description_tag);
            // we still publish it as plain top-level so worker can choose how to
            // surface it. Going through the engine first means cross-store pushes
            // drop the source brand from the SEO copy too.
            payload.put("seo_description",
                ReplaceEngine.applyAccumulating(p.getSeoDescription(), rules, ruleHits));
        }
        if (p.getSeoTitle() != null) {
            payload.put("seo_title",
                ReplaceEngine.applyAccumulating(p.getSeoTitle(), rules, ruleHits));
        }

        List<Map<String, Object>> variantPayloads = new ArrayList<>();
        for (ProductVariant v : variants) {
            Map<String, Object> vp = new LinkedHashMap<>();
            if (v.getSku() != null) vp.put("sku", v.getSku());
            BigDecimal price = v.getPrice() == null ? BigDecimal.ZERO : v.getPrice();
            vp.put("price", price.toPlainString());
            // W2-PUSH-02 spec: every pushed variant is enforced to a fixed
            // safety stock with continue policy so listings never go OOS.
            vp.put("inventory_quantity", 1000);
            vp.put("inventory_policy", "continue");
            if (v.getOption1() != null) vp.put("option1", v.getOption1());
            if (v.getOption2() != null) vp.put("option2", v.getOption2());
            if (v.getOption3() != null) vp.put("option3", v.getOption3());
            if (v.getCompareAtPrice() != null) vp.put("compare_at_price", v.getCompareAtPrice().toPlainString());
            if (v.getBarcode() != null) vp.put("barcode", v.getBarcode());
            if (v.getRequiresShipping() != null) vp.put("requires_shipping", v.getRequiresShipping());
            if (v.getTaxable() != null) vp.put("taxable", v.getTaxable());
            variantPayloads.add(vp);
        }
        payload.put("variants", variantPayloads);

        // Images: send both ``images[].src`` (caller-supplied URLs) AND
        // ``media_r2_keys`` (private R2 keys). Worker's ``_attach_r2_media``
        // appends R2-loaded entries AFTER caller-supplied src entries — both
        // coexist, the worker handles the merge. Precedence: src URLs come
        // first, R2 attachments appended after. If a row has only r2_key (no
        // src), it contributes only to ``media_r2_keys``.
        //
        // TODO: ProductImage.r2_key currently null for all rows (no callers
        // populate it yet). Follow-up: in ProductImageController upload +
        // CsvService import, call setR2Key(...) before insert.
        List<Map<String, Object>> imagePayloads = new ArrayList<>();
        List<String> mediaR2Keys = new ArrayList<>();
        for (ProductImage img : images) {
            if (img.getSrc() != null && !img.getSrc().isBlank()) {
                Map<String, Object> ip = new LinkedHashMap<>();
                ip.put("src", img.getSrc());
                if (img.getAltText() != null) ip.put("alt", img.getAltText());
                imagePayloads.add(ip);
            }
            if (img.getR2Key() != null && !img.getR2Key().isBlank()) {
                mediaR2Keys.add(img.getR2Key());
            }
        }
        if (!imagePayloads.isEmpty()) {
            payload.put("images", imagePayloads);
        }
        if (!mediaR2Keys.isEmpty()) {
            payload.put("media_r2_keys", mediaR2Keys);
        }

        // Metafields: re-seed on target store via worker GraphQL metafieldsSet.
        // Apply replace rules to `value` (the most likely place brand strings
        // appear, e.g. shop description / about copy). namespace/key/type are
        // identifiers and stay verbatim.
        if (metafields != null && !metafields.isEmpty()) {
            List<Map<String, Object>> mfPayloads = new ArrayList<>();
            for (ProductMetafield m : metafields) {
                if (m.getNamespace() == null || m.getKey() == null) continue;
                Map<String, Object> mp = new LinkedHashMap<>();
                mp.put("namespace", m.getNamespace());
                mp.put("key", m.getKey());
                mp.put("type", m.getType() == null ? "single_line_text_field" : m.getType());
                mp.put("value", ReplaceEngine.applyAccumulating(m.getValue(), rules, ruleHits));
                mfPayloads.add(mp);
            }
            if (!mfPayloads.isEmpty()) {
                payload.put("metafields", mfPayloads);
            }
        }
        return payload;
    }

    /**
     * Resolve the active replace-rule set for a push.
     *
     * <p>Resolution order:
     * <ol>
     *   <li>If {@code overrideVersionId} is provided, use ONLY that version's
     *       {@code default_replace_rules_json}. Per-store custom rules are
     *       deliberately skipped — caller wanted "this push pretends another
     *       template version is bound", and persisting custom diffs across
     *       versions opens too many edge cases.</li>
     *   <li>Else if a binding exists, merge the binding's version defaults
     *       with the binding's {@code custom_replace_rules_json} (custom
     *       wins on key collision).</li>
     *   <li>Else: empty rules — the engine becomes a no-op.</li>
     * </ol>
     */
    private ResolvedRules resolveRulesFor(long storeId, Long overrideVersionId) {
        if (overrideVersionId != null) {
            BaseTemplateVersion v = versionMapper.selectById(overrideVersionId);
            if (v == null) {
                throw new BusinessException(ResultCode.NOT_FOUND,
                    "templateVersionOverrideId not found: " + overrideVersionId);
            }
            return new ResolvedRules(overrideVersionId,
                bindingService.parseRules(v.getDefaultReplaceRulesJson()));
        }
        StoreTemplateBinding binding = bindingService.getOrEmpty(storeId);
        if (binding == null) {
            return new ResolvedRules(null, Map.of());
        }
        return new ResolvedRules(binding.getBaseTemplateVersionId(),
            bindingService.resolveMergedRules(
                binding.getBaseTemplateVersionId(), binding.getCustomReplaceRulesJson()));
    }

    private record ResolvedRules(Long versionId, Map<String, RuleSpec> rules) {}

    private void upsertStoreProduct(Long tenantId,
                                    long storeId,
                                    long productId,
                                    String shopifyProductId,
                                    String shopifyHandle,
                                    Long taskId) {
        StoreProduct existing = storeProductMapper.selectOne(
            new QueryWrapper<StoreProduct>()
                .eq("store_id", storeId)
                .eq("product_id", productId)
                .last("LIMIT 1")
        );
        LocalDateTime now = LocalDateTime.now();
        if (existing == null) {
            StoreProduct sp = new StoreProduct();
            sp.setTenantId(tenantId);
            sp.setStoreId(storeId);
            sp.setProductId(productId);
            sp.setShopifyProductId(shopifyProductId);
            sp.setShopifyHandle(shopifyHandle);
            sp.setStatus("ACTIVE");
            sp.setLastPushTaskId(taskId);
            sp.setLastPushedAt(now);
            storeProductMapper.insert(sp);
        } else {
            existing.setShopifyProductId(shopifyProductId);
            existing.setShopifyHandle(shopifyHandle);
            existing.setStatus("ACTIVE");
            existing.setLastPushTaskId(taskId);
            existing.setLastPushedAt(now);
            storeProductMapper.updateById(existing);
        }
    }

    private void persistConflict(Long taskId,
                                 long productId,
                                 long storeId,
                                 String conflictType,
                                 String detailJson) {
        PushConflict pc = new PushConflict();
        pc.setTaskId(taskId);
        pc.setProductId(productId);
        pc.setStoreId(storeId);
        pc.setConflictType(conflictType);
        pc.setDetailJson(detailJson);
        pc.setStatus("PENDING");
        conflictMapper.insert(pc);
    }

    private static String mapConflictType(String workerType) {
        if (workerType == null) return "OTHER";
        return switch (workerType) {
            case "HANDLE_RENAMED", "HANDLE_TAKEN" -> "HANDLE_TAKEN";
            case "VALIDATION" -> "VALIDATION";
            case "SKU_DUPLICATE" -> "SKU_DUPLICATE";
            case "VARIANT_OPTION_MISMATCH" -> "VARIANT_OPTION_MISMATCH";
            default -> "OTHER";
        };
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> extractDetail(Map<String, Object> resp) {
        if (resp == null) return null;
        Object detail = resp.get("detail");
        if (detail instanceof Map<?, ?>) {
            return (Map<String, Object>) detail;
        }
        return null;
    }

    private record WorkerResponse(int statusCode, String body) {}

    private WorkerResponse callWorker(String path, Map<String, Object> body) throws IOException {
        // Force HTTP/1.1 — same uvicorn h2c-upgrade gotcha as Day 5
        // SnapshotGenerationService. Keep both client + request pinned.
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
        return new WorkerResponse(resp.statusCode(), resp.body());
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static String asString(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    /**
     * Emit a {@code PRODUCT_PUSH_FAIL} notification (W2-PUSH-07).
     *
     * <p>Recipient resolution: prefer {@code triggeredBy} (the user that
     * initiated the push); fall back to the configurable admin id (defaults
     * to 1 — same convention as {@code StoreTokenScheduler}). The dispatcher
     * is async + best-effort; any failure is swallowed with a WARN so it
     * never breaks the push status update we just persisted.
     */
    private void notifyPushFail(Task task, long productId, long storeId, Long triggeredBy) {
        try {
            Long recipient = (triggeredBy != null) ? triggeredBy : failNotifyFallbackUserId;
            String subject = "商品推送失败";
            String bodyText = String.format(
                "商品推送失败：taskId=%d productId=%d storeId=%d，错误：%s",
                task.getId(), productId, storeId,
                task.getErrorMessage() == null ? "(unknown)" : task.getErrorMessage()
            );
            notificationDispatcher.notifyUser(
                recipient,
                NotificationEventCode.PRODUCT_PUSH_FAIL,
                subject,
                bodyText,
                null
            );
            log.info("[notify] dispatched PRODUCT_PUSH_FAIL taskId={} productId={} storeId={} recipient={}",
                task.getId(), productId, storeId, recipient);
        } catch (Exception e) {
            log.warn("[notify] PRODUCT_PUSH_FAIL skipped taskId={} err={}",
                task.getId(), e.getMessage());
        }
    }
}
