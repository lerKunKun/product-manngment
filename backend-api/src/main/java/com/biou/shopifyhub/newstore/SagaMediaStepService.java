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
 * W3-NEW-03: Saga MEDIA 步实现。
 *
 * <p>把 ctx.stepOutputs.mediaR2Keys（由 W3-TPL 模板渲染或上一步生成的占位）
 * 交给 worker {@code POST /push/files} 上传到目标 store 的 Shopify Files。
 * 完成后把每个 R2 key 对应的 Shopify file id / cdn url 写回 ctx.stepOutputs.media，
 * 供后续 PRODUCTS / THEME 步引用。
 *
 * <p>Day 3 简化策略：
 * <ul>
 *   <li>无 mediaR2Keys 时传空列表，worker 直接返回空 + 200，本步仍 advance（不视为失败）。</li>
 *   <li>worker dry-run 模式下回写的是合成 gid（不影响 saga 推进）。</li>
 * </ul>
 *
 * <p>失败语义全交给 {@link SagaService#executeStep}：lambda 抛任何异常 → fail + 抛
 * {@link SagaStepException}。
 */
@Service
public class SagaMediaStepService {

    private static final Logger log = LoggerFactory.getLogger(SagaMediaStepService.class);

    private final SagaService sagaService;
    private final ObjectMapper objectMapper;

    @Value("${shopify.worker.base-url:http://localhost:8765}")
    private String workerBaseUrl;

    @Value("${shopify.worker.call-timeout-seconds:120}")
    private long workerTimeoutSeconds;

    @Value("${shopify.worker.token:}")
    private String workerToken;

    public SagaMediaStepService(SagaService sagaService, ObjectMapper objectMapper) {
        this.sagaService = sagaService;
        this.objectMapper = objectMapper;
    }

    public void run(Long taskId) {
        sagaService.executeStep(taskId, SagaStep.AUTH_DONE, ctx -> {
            List<String> r2Keys = readR2Keys(ctx);

            Map<String, Object> req = new LinkedHashMap<>();
            req.put("shop_domain", ctx.shopDomain());
            req.put("tenant_id", ctx.tenantId());
            req.put("store_id", ctx.storeId());
            req.put("task_id", taskId);
            req.put("r2_keys", r2Keys);
            // 跨公司 / custom_app 的 access_token 由 SagaAuthService 灌入 ctx；mock 路径同样。
            if (ctx.shopAccessToken() != null && !ctx.shopAccessToken().isBlank()) {
                req.put("access_token", ctx.shopAccessToken());
            }

            Map<String, Object> resp;
            try {
                resp = callWorker("/push/files", req);
            } catch (IOException e) {
                throw new RuntimeException("worker /push/files failed: " + e.getMessage(), e);
            }

            Map<String, Object> stepOutputs = new LinkedHashMap<>(
                ctx.stepOutputs() == null ? Map.of() : ctx.stepOutputs()
            );
            Object files = resp.get("files");
            stepOutputs.put("media", files == null ? List.of() : files);
            log.info("[saga-media] taskId={} pushed {} files (dry_run={})",
                taskId,
                files instanceof List<?> l ? l.size() : 0,
                resp.get("dry_run"));

            return new SagaContext(
                ctx.taskId(), ctx.tenantId(), ctx.storeId(), ctx.shopDomain(), ctx.shopAccessToken(),
                ctx.templateId(), ctx.replaceRules(), ctx.productIdsToPush(), stepOutputs
            );
        });
    }

    @SuppressWarnings("unchecked")
    private List<String> readR2Keys(SagaContext ctx) {
        if (ctx.stepOutputs() == null) return List.of();
        Object v = ctx.stepOutputs().get("mediaR2Keys");
        if (v instanceof List<?> l) {
            List<String> out = new ArrayList<>(l.size());
            for (Object o : l) {
                if (o != null) out.add(o.toString());
            }
            return out;
        }
        return List.of();
    }

    private Map<String, Object> callWorker(String path, Map<String, Object> body) throws IOException {
        // 与 SnapshotGenerationService 保持一致：强制 HTTP/1.1，避免 uvicorn 升级握手把 body 丢掉。
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
