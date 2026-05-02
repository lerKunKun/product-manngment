package com.biou.shopifyhub.newstore;

import com.biou.shopifyhub.push.PushService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * W3-NEW-05: Saga PRODUCTS step.
 *
 * <p>Reads {@code ctx.productIdsToPush} and triggers a batch push to
 * {@code ctx.storeId} via {@link PushService#pushBatch}. Writes the
 * {@link PushService.BatchResult} back into {@code ctx.stepOutputs.products}
 * so downstream steps (GUIDE / THEME / PUBLISH) can inspect what shipped.
 *
 * <p>Behaviour rules (Day 4 simplification):
 * <ul>
 *   <li>Empty / null {@code productIdsToPush} → log + advance with a
 *       {@code {skipped:true}} marker; do NOT throw. This keeps the saga
 *       moving when the user has no products to push (template-only flow).</li>
 *   <li>Hard fail (every push failed, success==0 && failed>0) → throw so the
 *       saga lands in FAILED at PRODUCTS and can be retried.</li>
 *   <li>Partial failure → still advance to GUIDE; {@code push_conflict} rows
 *       and per-sub task statuses are already recorded by {@code PushService}
 *       and the user can review / re-push later.</li>
 * </ul>
 */
@Service
public class SagaProductsStepService {

    private static final Logger log = LoggerFactory.getLogger(SagaProductsStepService.class);

    private final SagaService sagaService;
    private final PushService pushService;

    public SagaProductsStepService(SagaService sagaService, PushService pushService) {
        this.sagaService = sagaService;
        this.pushService = pushService;
    }

    public void run(Long taskId) {
        sagaService.executeStep(taskId, SagaStep.COLLECTIONS, ctx -> {
            List<Long> productIds = ctx.productIdsToPush();
            Map<String, Object> outputs = new LinkedHashMap<>(
                ctx.stepOutputs() == null ? Map.of() : ctx.stepOutputs()
            );

            if (productIds == null || productIds.isEmpty()) {
                log.info("[saga-products] taskId={} empty productIdsToPush — advancing without push", taskId);
                Map<String, Object> skipped = new LinkedHashMap<>();
                skipped.put("skipped", true);
                skipped.put("reason", "no productIds");
                outputs.put("products", skipped);
                return new SagaContext(
                    ctx.taskId(), ctx.tenantId(), ctx.storeId(), ctx.shopDomain(), ctx.shopAccessToken(),
                    ctx.templateId(), ctx.replaceRules(), ctx.productIdsToPush(), outputs
                );
            }

            PushService.BatchResult r = pushService.pushBatch(productIds, ctx.storeId(), null);
            log.info("[saga-products] taskId={} pushed parentTaskId={} subTaskIds={} success={} failed={} partial={}",
                taskId, r.parentTaskId(), r.subTaskIds(), r.success(), r.failed(), r.partial());

            Map<String, Object> productsOut = new LinkedHashMap<>();
            productsOut.put("parentTaskId", r.parentTaskId());
            productsOut.put("subTaskIds", r.subTaskIds());
            productsOut.put("success", r.success());
            productsOut.put("failed", r.failed());
            productsOut.put("partial", r.partial());
            productsOut.put("totalRequested", productIds.size());
            outputs.put("products", productsOut);

            // Hard fail: every push failed → throw so saga lands FAILED at PRODUCTS.
            if (r.success() == 0 && r.failed() > 0) {
                throw new RuntimeException("PRODUCTS step: all " + r.failed() + " pushes failed");
            }

            // Partial failure → still advance; conflict rows are already persisted.
            return new SagaContext(
                ctx.taskId(), ctx.tenantId(), ctx.storeId(), ctx.shopDomain(), ctx.shopAccessToken(),
                ctx.templateId(), ctx.replaceRules(), ctx.productIdsToPush(), outputs
            );
        });
    }
}
