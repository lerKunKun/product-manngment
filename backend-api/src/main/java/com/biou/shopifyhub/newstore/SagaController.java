package com.biou.shopifyhub.newstore;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.push.entity.Task;
import com.biou.shopifyhub.push.mapper.TaskMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Saga endpoints for the one-key-store flow.
 *
 * <ul>
 *   <li>{@code GET /saga/{id}} — 查 saga 状态（W3-NEW-01）</li>
 *   <li>{@code POST /saga/{id}/retry} — 重试失败 saga（W3-NEW-01）</li>
 *   <li>{@code POST /saga/{id}/advance} — DEV 手动推进（W3-NEW-01）</li>
 *   <li>{@code POST /saga/start} — 启动新 saga 并返回 OAuth URL（W3-NEW-02）</li>
 *   <li>{@code POST /saga/{id}/dev-mock-auth} — DEV 跳过真 OAuth（W3-NEW-02）</li>
 * </ul>
 */
@RestController
@RequestMapping("/saga")
public class SagaController {

    private final SagaService sagaService;
    private final TaskMapper taskMapper;
    private final ObjectMapper objectMapper;
    private final SagaAuthService sagaAuthService;
    private final SagaMediaStepService sagaMediaStepService;
    private final SagaCollectionsStepService sagaCollectionsStepService;
    private final SagaProductsStepService sagaProductsStepService;
    private final SagaGuideStepService sagaGuideStepService;
    private final SagaThemeStepService sagaThemeStepService;

    public SagaController(SagaService sagaService,
                          TaskMapper taskMapper,
                          ObjectMapper objectMapper,
                          SagaAuthService sagaAuthService,
                          SagaMediaStepService sagaMediaStepService,
                          SagaCollectionsStepService sagaCollectionsStepService,
                          SagaProductsStepService sagaProductsStepService,
                          SagaGuideStepService sagaGuideStepService,
                          SagaThemeStepService sagaThemeStepService) {
        this.sagaService = sagaService;
        this.taskMapper = taskMapper;
        this.objectMapper = objectMapper;
        this.sagaAuthService = sagaAuthService;
        this.sagaMediaStepService = sagaMediaStepService;
        this.sagaCollectionsStepService = sagaCollectionsStepService;
        this.sagaProductsStepService = sagaProductsStepService;
        this.sagaGuideStepService = sagaGuideStepService;
        this.sagaThemeStepService = sagaThemeStepService;
    }

    /** Returns saga state for a task: status, step, attempt, ctx (parsed). */
    @GetMapping("/{taskId}")
    public Result<Map<String, Object>> get(@PathVariable Long taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !"NEW_STORE_SAGA".equals(t.getType())) {
            return Result.error(40404, "saga not found");
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("taskId", t.getId());
        resp.put("status", t.getStatus());
        resp.put("step", t.getSagaStep());
        resp.put("attempt", t.getSagaAttempt());
        resp.put("startedAt", t.getStartedAt());
        resp.put("completedAt", t.getCompletedAt());
        resp.put("errorMessage", t.getErrorMessage());
        try {
            if (t.getSagaDataJson() != null && !t.getSagaDataJson().isBlank()) {
                resp.put("context", objectMapper.readValue(t.getSagaDataJson(), Map.class));
            }
        } catch (Exception ignored) {
            // context omitted on parse failure; status fields are still useful
        }
        return Result.ok(resp);
    }

    /** Retries a FAILED saga from its last step. */
    @PostMapping("/{taskId}/retry")
    public Result<Map<String, Object>> retry(@PathVariable Long taskId) {
        sagaService.retry(taskId);
        return get(taskId);
    }

    /**
     * (DEV-ONLY) Advances saga to the next step manually with provided ctx update.
     * Production triggers come from each step's business handler (W3-NEW-02..08).
     */
    @PostMapping("/{taskId}/advance")
    public Result<Map<String, Object>> advance(@PathVariable Long taskId,
                                               @RequestBody(required = false) Map<String, Object> ctxPatch) {
        SagaContext ctx = sagaService.loadContext(taskId);
        // Simple shallow merge for dev convenience; production handlers build a proper SagaContext.
        if (ctxPatch != null) {
            // For Day 1: ctxPatch is intentionally ignored. W3-NEW-02..08 will call
            // SagaService.advance(taskId, properlyConstructedCtx) directly.
        }
        sagaService.advance(taskId, ctx);
        return get(taskId);
    }

    /**
     * W3-NEW-02：启动新 saga + 返回 Shopify OAuth URL（若提供了 shopDomainHint）。
     *
     * <ul>
     *   <li>tenantId / triggeredBy 优先取请求体，缺失时退回当前登录 user / 默认 1。</li>
     *   <li>shopDomainHint 缺失：oauthUrl=null —— 由前端引导用户填域名后再调一次。</li>
     * </ul>
     */
    @PostMapping("/start")
    public Result<Map<String, Object>> start(@RequestBody(required = false) StartRequest req) {
        if (req == null) req = new StartRequest(null, null, null, null, null, null);

        Long tenantId = req.tenantId() != null ? req.tenantId() : CurrentUser.tenantId();
        if (tenantId == null) tenantId = 1L;
        Long triggeredBy = req.triggeredBy() != null ? req.triggeredBy() : CurrentUser.userIdOrNull();

        Map<String, Object> initial = new LinkedHashMap<>();
        initial.put("templateId", req.templateId());
        initial.put("replaceRules", req.replaceRules() != null ? req.replaceRules() : Map.of());
        initial.put("productIds", req.productIds() != null ? req.productIds() : List.of());
        initial.put("shopDomainHint", req.shopDomainHint());

        Long taskId = sagaService.start(tenantId, triggeredBy, initial);
        String oauthUrl = sagaAuthService.buildInstallUrl(taskId, req.shopDomainHint());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("taskId", taskId);
        resp.put("oauthUrl", oauthUrl);
        resp.put("needShopDomainPrompt", oauthUrl == null);
        return Result.ok(resp);
    }

    /**
     * W3-NEW-02 DEV-ONLY：跳过真实 Shopify OAuth，直接落 store + 推进 saga 到 AUTH_DONE。
     * 受 {@code shopify.dev-mock-oauth=true} 控制；生产应设为 false 关闭此入口。
     */
    @PostMapping("/{taskId}/dev-mock-auth")
    public Result<Map<String, Object>> devMockAuth(@PathVariable Long taskId,
                                                   @RequestBody DevMockAuthRequest req) {
        return Result.ok(sagaAuthService.mockAuth(taskId, req.shopDomain(), req.accessToken()));
    }

    /**
     * W3-NEW-03: 手动触发 MEDIA 步（AUTH_DONE → MEDIA → COLLECTIONS）。
     * 生产由 saga orchestrator 在 AUTH_DONE 完成后自动链；dev 阶段提供此入口便于联调。
     */
    @PostMapping("/{taskId}/step/run-media")
    public Result<Map<String, Object>> runMedia(@PathVariable Long taskId) {
        sagaMediaStepService.run(taskId);
        return get(taskId);
    }

    /**
     * W3-NEW-04: 手动触发 COLLECTIONS 步（MEDIA → COLLECTIONS → PRODUCTS）。
     * 生产由 saga orchestrator 在 MEDIA 完成后自动链；dev 阶段提供此入口便于联调。
     */
    @PostMapping("/{taskId}/step/run-collections")
    public Result<Map<String, Object>> runCollections(@PathVariable Long taskId) {
        sagaCollectionsStepService.run(taskId);
        return get(taskId);
    }

    /**
     * W3-NEW-05: 手动触发 PRODUCTS 步（COLLECTIONS → PRODUCTS → GUIDE）。
     * 走 PushService.pushBatch；空 productIdsToPush 直接 advance；全失败抛错；
     * 部分失败仍 advance（push_conflict 行已落库，可后续解决）。
     */
    @PostMapping("/{taskId}/step/run-products")
    public Result<Map<String, Object>> runProducts(@PathVariable Long taskId) {
        sagaProductsStepService.run(taskId);
        return get(taskId);
    }

    /**
     * W3-NEW-08: 手动触发 GUIDE 步（PRODUCTS → GUIDE → THEME）。
     * 收集已发布的 saga GUIDE 指引文档，写入 ctx.stepOutputs.guides，
     * 前端 wizard 据此渲染"请阅读以下指南"链接。
     */
    @PostMapping("/{taskId}/step/run-guide")
    public Result<Map<String, Object>> runGuide(@PathVariable Long taskId) {
        sagaGuideStepService.run(taskId);
        return get(taskId);
    }

    /**
     * W3-NEW-06 + W3-NEW-07: 手动触发 THEME 步（GUIDE → THEME → PUBLISH）。
     * 加载 base_template 默认版本的 zipR2Key + default_replace_rules，与 ctx.replaceRules
     * 合并后调 worker /push/theme 安装到目标 store。无 templateId → 跳过仍 advance。
     */
    @PostMapping("/{taskId}/step/run-theme")
    public Result<Map<String, Object>> runTheme(@PathVariable Long taskId) {
        sagaThemeStepService.run(taskId);
        return get(taskId);
    }

    public record StartRequest(
        Long tenantId,
        Long triggeredBy,
        Long templateId,
        Map<String, Object> replaceRules,
        List<Long> productIds,
        String shopDomainHint
    ) {}

    public record DevMockAuthRequest(
        String shopDomain,
        String accessToken
    ) {}
}
