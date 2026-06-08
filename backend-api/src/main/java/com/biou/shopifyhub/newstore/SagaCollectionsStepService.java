package com.biou.shopifyhub.newstore;

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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * W3-NEW-04: Saga COLLECTIONS 步实现。
 *
 * <p>把 ctx.stepOutputs.collections（由模板带入或上一步注入）交给 worker
 * {@code POST /push/collections} 在目标 store 创建 custom collections，
 * 然后把 worker 返回的 per-collection 结果（含 shopify_id / handle / 可能的 error）
 * 写回 ctx.stepOutputs.collections_created，供 PRODUCTS 步关联。
 *
 * <p>Day 3 默认值：模板未提供 collections 时退回 {@code [{"all"},{"new"}]}，
 * 让 saga 在没有完整模板的情况下也能跑通。
 */
@Service
public class SagaCollectionsStepService {

    private static final Logger log = LoggerFactory.getLogger(SagaCollectionsStepService.class);

    private final SagaService sagaService;
    private final ObjectMapper objectMapper;

    @Value("${shopify.worker.base-url:http://localhost:8765}")
    private String workerBaseUrl;

    @Value("${shopify.worker.call-timeout-seconds:120}")
    private long workerTimeoutSeconds;

    @Value("${shopify.worker.token:}")
    private String workerToken;

    public SagaCollectionsStepService(SagaService sagaService, ObjectMapper objectMapper) {
        this.sagaService = sagaService;
        this.objectMapper = objectMapper;
    }

    public void run(Long taskId) {
        sagaService.executeStep(taskId, SagaStep.MEDIA, ctx -> {
            List<Map<String, Object>> collections = readCollections(ctx);

            Map<String, Object> req = new LinkedHashMap<>();
            req.put("shop_domain", ctx.shopDomain());
            req.put("tenant_id", ctx.tenantId());
            req.put("store_id", ctx.storeId());
            req.put("task_id", taskId);
            req.put("collections", collections);
            if (ctx.shopAccessToken() != null && !ctx.shopAccessToken().isBlank()) {
                req.put("access_token", ctx.shopAccessToken());
            }

            Map<String, Object> resp;
            try {
                resp = callWorker("/push/collections", req);
            } catch (IOException e) {
                throw new RuntimeException("worker /push/collections failed: " + e.getMessage(), e);
            }

            Map<String, Object> stepOutputs = new LinkedHashMap<>(
                ctx.stepOutputs() == null ? Map.of() : ctx.stepOutputs()
            );
            Object created = resp.get("collections");
            stepOutputs.put("collections_created", created == null ? List.of() : created);
            log.info("[saga-collections] taskId={} created {} collections (dry_run={})",
                taskId,
                created instanceof List<?> l ? l.size() : 0,
                resp.get("dry_run"));

            return new SagaContext(
                ctx.taskId(), ctx.tenantId(), ctx.storeId(), ctx.shopDomain(), ctx.shopAccessToken(),
                ctx.templateId(), ctx.replaceRules(), ctx.productIdsToPush(), stepOutputs
            );
        });
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> readCollections(SagaContext ctx) {
        if (ctx.stepOutputs() != null) {
            Object v = ctx.stepOutputs().get("collections");
            if (v instanceof List<?> l) {
                List<Map<String, Object>> out = new ArrayList<>(l.size());
                for (Object o : l) {
                    if (o instanceof Map<?, ?> m) {
                        Map<String, Object> typed = new LinkedHashMap<>();
                        for (Map.Entry<?, ?> e : m.entrySet()) {
                            typed.put(String.valueOf(e.getKey()), e.getValue());
                        }
                        out.add(typed);
                    }
                }
                if (!out.isEmpty()) return out;
            }
        }
        // Day 3 fallback: 至少建两个空 collection 让 PRODUCTS 步有可关联目标。
        return List.of(
            Map.of("handle", "all", "title", "All Products"),
            Map.of("handle", "new", "title", "New Arrivals")
        );
    }

    private Map<String, Object> callWorker(String path, Map<String, Object> body) throws IOException {
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
}
