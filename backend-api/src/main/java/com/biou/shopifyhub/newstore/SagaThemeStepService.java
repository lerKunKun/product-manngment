package com.biou.shopifyhub.newstore;

import com.biou.shopifyhub.template.entity.BaseTemplate;
import com.biou.shopifyhub.template.entity.BaseTemplateVersion;
import com.biou.shopifyhub.template.mapper.BaseTemplateMapper;
import com.biou.shopifyhub.template.mapper.BaseTemplateVersionMapper;
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
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * W3-NEW-06 + W3-NEW-07: Saga THEME step.
 *
 * <p>Resolves the {@link BaseTemplate#getDefaultTemplateVersionId() default version}
 * of the saga's templateId, merges its {@code default_replace_rules_json}
 * with {@code ctx.replaceRules} (ctx wins on key conflict), then calls the
 * worker {@code POST /push/theme} to:
 * <ol>
 *   <li>pull the version's zip from R2,</li>
 *   <li>apply replace rules to text files inside the zip,</li>
 *   <li>upload modified zip back to R2,</li>
 *   <li>install on the target store via Shopify REST themes.json src URL,</li>
 *   <li>optionally publish (role=main) when {@code shopify.theme.publish-after-install=true}.</li>
 * </ol>
 *
 * <p>Failure semantics — same as the other saga step services:
 * lambda exceptions are translated by {@link SagaService#executeStep} into
 * a {@code FAILED} task at THEME and a {@link SagaStepException} thrown to
 * the controller. Missing templateId is a NON-fatal skip (advance with a
 * {@code skipped:true} marker) so the saga still completes when the user
 * runs without a base template.
 */
@Service
public class SagaThemeStepService {

    private static final Logger log = LoggerFactory.getLogger(SagaThemeStepService.class);

    private final SagaService sagaService;
    private final BaseTemplateMapper templateMapper;
    private final BaseTemplateVersionMapper versionMapper;
    private final ObjectMapper objectMapper;

    @Value("${shopify.worker.base-url:http://localhost:8765}")
    private String workerBaseUrl;

    @Value("${shopify.worker.call-timeout-seconds:120}")
    private long workerTimeoutSeconds;

    @Value("${shopify.theme.publish-after-install:false}")
    private boolean publishAfterInstall;

    public SagaThemeStepService(SagaService sagaService,
                                BaseTemplateMapper templateMapper,
                                BaseTemplateVersionMapper versionMapper,
                                ObjectMapper objectMapper) {
        this.sagaService = sagaService;
        this.templateMapper = templateMapper;
        this.versionMapper = versionMapper;
        this.objectMapper = objectMapper;
    }

    public void run(Long taskId) {
        sagaService.executeStep(taskId, SagaStep.GUIDE, ctx -> {
            Map<String, Object> outputs = new LinkedHashMap<>(
                ctx.stepOutputs() == null ? Map.of() : ctx.stepOutputs()
            );

            if (ctx.templateId() == null) {
                log.warn("[saga-theme] taskId={} no templateId in ctx — advancing with skipped marker", taskId);
                Map<String, Object> skipped = new LinkedHashMap<>();
                skipped.put("skipped", true);
                skipped.put("reason", "no templateId");
                outputs.put("theme", skipped);
                return rebuildCtx(ctx, outputs);
            }

            BaseTemplate t = templateMapper.selectById(ctx.templateId());
            if (t == null) {
                throw new RuntimeException("template " + ctx.templateId() + " not found");
            }
            if (t.getDefaultTemplateVersionId() == null) {
                throw new RuntimeException("template " + ctx.templateId() + " has no default version");
            }
            BaseTemplateVersion v = versionMapper.selectById(t.getDefaultTemplateVersionId());
            if (v == null) {
                throw new RuntimeException(
                    "template version " + t.getDefaultTemplateVersionId() + " not found"
                );
            }
            if (v.getZipR2Key() == null || v.getZipR2Key().isBlank()) {
                throw new RuntimeException(
                    "template version " + v.getId() + " missing zipR2Key"
                );
            }

            // Merge default replace rules + ctx.replaceRules (ctx wins on key conflict).
            Map<String, Object> rules = new LinkedHashMap<>();
            String defaultRulesJson = v.getDefaultReplaceRulesJson();
            if (defaultRulesJson != null && !defaultRulesJson.isBlank()) {
                try {
                    Map<String, Object> defaults = objectMapper.readValue(
                        defaultRulesJson, new TypeReference<Map<String, Object>>() {}
                    );
                    if (defaults != null) rules.putAll(defaults);
                } catch (Exception e) {
                    log.warn(
                        "[saga-theme] taskId={} default_replace_rules_json parse failed: {}",
                        taskId, e.getMessage()
                    );
                }
            }
            if (ctx.replaceRules() != null) {
                rules.putAll(ctx.replaceRules());
            }

            Map<String, Object> reqBody = new LinkedHashMap<>();
            reqBody.put("shop_domain", ctx.shopDomain());
            reqBody.put("tenant_id", ctx.tenantId());
            reqBody.put("store_id", ctx.storeId());
            reqBody.put("task_id", taskId);
            reqBody.put("source_zip_r2_key", v.getZipR2Key());
            reqBody.put("replace_rules", rules);
            reqBody.put("theme_name_prefix", "saga-" + ctx.templateId());
            reqBody.put("publish", publishAfterInstall);
            if (ctx.shopAccessToken() != null && !ctx.shopAccessToken().isBlank()) {
                reqBody.put("access_token", ctx.shopAccessToken());
            }

            Map<String, Object> resp;
            try {
                resp = callWorker("/push/theme", reqBody);
            } catch (IOException e) {
                throw new RuntimeException("worker /push/theme failed: " + e.getMessage(), e);
            }

            outputs.put("theme", resp);
            log.info(
                "[saga-theme] taskId={} themeId={} role={} rules_applied={} dry_run={}",
                taskId,
                resp.get("shopify_theme_id"),
                resp.get("shopify_theme_role"),
                resp.get("rules_applied_count"),
                resp.get("dry_run")
            );

            return rebuildCtx(ctx, outputs);
        });
    }

    private SagaContext rebuildCtx(SagaContext ctx, Map<String, Object> outputs) {
        return new SagaContext(
            ctx.taskId(),
            ctx.tenantId(),
            ctx.storeId(),
            ctx.shopDomain(),
            ctx.shopAccessToken(),
            ctx.templateId(),
            ctx.replaceRules(),
            ctx.productIdsToPush(),
            outputs
        );
    }

    private Map<String, Object> callWorker(String path, Map<String, Object> body) throws IOException {
        // 与 SagaMediaStepService / SnapshotGenerationService 保持一致：强制 HTTP/1.1，
        // 避免 uvicorn 升级握手把 body 丢掉。
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
}
