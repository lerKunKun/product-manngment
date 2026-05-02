package com.biou.shopifyhub.newstore;

import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import com.biou.shopifyhub.push.entity.Task;
import com.biou.shopifyhub.push.mapper.TaskMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Saga orchestration service for the one-key-store flow (W3-NEW-01).
 *
 * <p>Provides the framework only — individual step implementations
 * (AUTH_DONE / MEDIA / COLLECTIONS / PRODUCTS / GUIDE / THEME / PUBLISH)
 * are wired in by W3-NEW-02..08 via {@link #executeStep} or direct
 * {@link #advance} / {@link #fail} calls.
 *
 * <p>State machine: see {@link SagaStep}. Persistence: extends
 * {@code task} table with {@code saga_step / saga_data_json / saga_attempt}
 * (Flyway V13).
 */
@Service
public class SagaService {

    private static final Logger log = LoggerFactory.getLogger(SagaService.class);

    private final TaskMapper taskMapper;
    private final ObjectMapper objectMapper;

    /**
     * W3-NEW-09: progress fan-out. {@code @Lazy} avoids any future cycle if
     * {@link SagaProgressService} ever wants to depend on this service. All
     * emit calls are best-effort (the progress service swallows errors), so
     * the saga state machine is never blocked by an SSE hiccup.
     */
    @Autowired
    @Lazy
    private SagaProgressService progressService;

    /**
     * W3-NEW-11: saga 完成通知。{@code @Lazy} 防潜在循环依赖
     * （NotificationDispatcher → 任意上游 → SagaService）。
     * 通知发送失败不影响 saga 状态机。
     */
    @Autowired
    @Lazy
    private NotificationDispatcher notificationDispatcher;

    public SagaService(TaskMapper taskMapper, ObjectMapper objectMapper) {
        this.taskMapper = taskMapper;
        this.objectMapper = objectMapper;
    }

    /** 启动新 saga：创建 task 行 + saga_step=INIT。返回 taskId。 */
    public Long start(Long tenantId, Long triggeredBy, Map<String, Object> initialPayload) {
        Task t = new Task();
        t.setTenantId(tenantId);
        t.setType("NEW_STORE_SAGA");
        t.setStatus("RUNNING");
        t.setSagaStep(SagaStep.INIT.name());
        t.setSagaAttempt(0);
        t.setTriggeredBy(triggeredBy);
        t.setStartedAt(LocalDateTime.now());
        try {
            t.setPayloadJson(objectMapper.writeValueAsString(initialPayload != null ? initialPayload : Map.of()));
        } catch (Exception e) {
            t.setPayloadJson("{}");
        }
        SagaContext ctx = SagaContext.empty(null, tenantId);
        if (initialPayload != null && !initialPayload.isEmpty()) {
            ctx = mergeInitialPayload(ctx, initialPayload);
        }
        t.setSagaDataJson(serializeContext(ctx));
        taskMapper.insert(t);
        log.info("[saga] started taskId={} tenantId={}", t.getId(), tenantId);
        emitProgress(t.getId(), "started", SagaStep.INIT.name(), "RUNNING", null);
        return t.getId();
    }

    /**
     * 清技术债 #12：把 initialPayload 中已知的 saga ctx 字段拷贝进 ctx，
     * 这样 PRODUCTS / THEME 等步骤无需通过 SQL workaround 注入 productIdsToPush /
     * templateId / replaceRules。
     *
     * <p>shopDomainHint 是 wizard-only 提示，AUTH_DONE 步骤填充 shopDomain 字段，
     * 这里不在 ctx 中预填。
     */
    @SuppressWarnings("unchecked")
    private SagaContext mergeInitialPayload(SagaContext ctx, Map<String, Object> p) {
        Long templateId = numberToLong(p.get("templateId"));
        Map<String, String> replaceRules = ctx.replaceRules();
        Object rrObj = p.get("replaceRules");
        if (rrObj instanceof Map<?, ?> m) {
            replaceRules = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (e.getKey() == null) continue;
                replaceRules.put(String.valueOf(e.getKey()),
                    e.getValue() == null ? "" : String.valueOf(e.getValue()));
            }
        }
        List<Long> productIds = ctx.productIdsToPush();
        Object pidObj = p.get("productIdsToPush");
        if (pidObj == null) pidObj = p.get("productIds");
        if (pidObj instanceof List<?> l) {
            productIds = new ArrayList<>();
            for (Object o : l) {
                Long lid = numberToLong(o);
                if (lid != null) productIds.add(lid);
            }
        }
        return new SagaContext(
            ctx.taskId(),
            ctx.tenantId(),
            ctx.storeId(),
            ctx.shopDomain(),
            ctx.shopAccessToken(),
            templateId != null ? templateId : ctx.templateId(),
            replaceRules,
            productIds,
            ctx.stepOutputs()
        );
    }

    private static Long numberToLong(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(String.valueOf(v));
        } catch (Exception e) {
            return null;
        }
    }

    /** 推进到下一步（成功路径）。需先确保当前 step 的业务逻辑已完成、ctx 已更新。 */
    public void advance(Long taskId, SagaContext newCtx) {
        Task t = requireTask(taskId);
        SagaStep current = SagaStep.valueOf(t.getSagaStep());
        SagaStep next = current.next();
        if (next == null) {
            log.warn("[saga] taskId={} already terminal step={}", taskId, current);
            return;
        }
        t.setSagaStep(next.name());
        t.setSagaAttempt(0);
        t.setSagaDataJson(serializeContext(newCtx));
        if (next == SagaStep.SUCCESS) {
            t.setStatus("SUCCESS");
            t.setCompletedAt(LocalDateTime.now());
        }
        taskMapper.updateById(t);
        log.info("[saga] advance taskId={} {} -> {}", taskId, current, next);
        emitProgress(
            taskId,
            "advanced",
            next.name(),
            next == SagaStep.SUCCESS ? "SUCCESS" : "RUNNING",
            Map.of("from", current.name(), "to", next.name())
        );
        if (next == SagaStep.SUCCESS) {
            notifySagaSuccess(t, newCtx);
        }
    }

    /** 标记 saga 失败：保留 step 在最后失败点，便于 retry。 */
    public void fail(Long taskId, String errorMessage, SagaContext ctx) {
        Task t = requireTask(taskId);
        SagaStep failedAt = SagaStep.valueOf(t.getSagaStep());
        t.setStatus("FAILED");
        t.setErrorMessage(truncate(errorMessage, 1000));
        t.setCompletedAt(LocalDateTime.now());
        if (ctx != null) t.setSagaDataJson(serializeContext(ctx));
        taskMapper.updateById(t);
        log.warn("[saga] FAILED taskId={} step={} err={}", taskId, failedAt, errorMessage);
        emitProgress(
            taskId,
            "failed",
            failedAt.name(),
            "FAILED",
            Map.of("error", errorMessage == null ? "" : errorMessage)
        );
        notifySagaFail(t, errorMessage);
    }

    /** 重试当前失败的 step（saga_attempt++）。状态从 FAILED 切回 RUNNING。 */
    public void retry(Long taskId) {
        Task t = requireTask(taskId);
        if (!"FAILED".equals(t.getStatus())) {
            throw new IllegalStateException("can only retry FAILED tasks; current=" + t.getStatus());
        }
        t.setStatus("RUNNING");
        int prev = t.getSagaAttempt() == null ? 0 : t.getSagaAttempt();
        t.setSagaAttempt(prev + 1);
        t.setErrorMessage(null);
        t.setCompletedAt(null);
        taskMapper.updateById(t);
        log.info("[saga] retry taskId={} step={} attempt={}", taskId, t.getSagaStep(), t.getSagaAttempt());
        emitProgress(
            taskId,
            "retried",
            t.getSagaStep(),
            "RUNNING",
            Map.of("attempt", t.getSagaAttempt())
        );
    }

    /** Best-effort progress emit; never throws. {@code progressService} is {@code @Lazy}-injected. */
    private void emitProgress(Long taskId, String event, String step, String status, Map<String, Object> extra) {
        if (taskId == null || progressService == null) return;
        try {
            progressService.publish(taskId, event, step, status, extra);
        } catch (Exception e) {
            log.debug("[saga] emit progress failed taskId={} event={} err={}", taskId, event, e.getMessage());
        }
    }

    /**
     * W3-NEW-11: saga 成功 → 通知发起人。
     * Best-effort，任何失败仅 warn，不影响 saga 状态机。
     */
    private void notifySagaSuccess(Task t, SagaContext ctx) {
        try {
            Long userId = t.getTriggeredBy();
            if (userId == null) {
                log.debug("[saga] NEW_STORE_SUCCESS skip: no triggeredBy taskId={}", t.getId());
                return;
            }
            String shopDomain = ctx != null && ctx.shopDomain() != null ? ctx.shopDomain() : ("task " + t.getId());
            String subject = "一键开店完成: " + shopDomain;
            String durationMin = (t.getStartedAt() != null && t.getCompletedAt() != null)
                ? String.valueOf(Duration.between(t.getStartedAt(), t.getCompletedAt()).toMinutes())
                : "未知";
            String bodyText = String.format(
                "Saga %d 已完成。%n店铺域名: %s%n开店时长: %s 分钟。%n查看详情: /newstore/%d",
                t.getId(), shopDomain, durationMin, t.getId()
            );
            String bodyHtml = "<h3>" + subject + "</h3><p>" + bodyText.replace("\n", "<br/>") + "</p>";
            notificationDispatcher.notifyUser(userId, NotificationEventCode.NEW_STORE_SUCCESS, subject, bodyText, bodyHtml);
            log.info("[saga] NEW_STORE_SUCCESS notify dispatched taskId={} userId={}", t.getId(), userId);
        } catch (Exception e) {
            log.warn("[saga] NEW_STORE_SUCCESS notify failed taskId={} err={}", t.getId(), e.getMessage());
        }
    }

    /**
     * W3-NEW-11: saga 失败 → 通知发起人。
     * Best-effort，任何失败仅 warn，不影响 saga 状态机。
     */
    private void notifySagaFail(Task t, String errorMessage) {
        try {
            Long userId = t.getTriggeredBy();
            if (userId == null) {
                log.debug("[saga] NEW_STORE_FAIL skip: no triggeredBy taskId={}", t.getId());
                return;
            }
            String subject = "一键开店失败 (taskId=" + t.getId() + ")";
            String bodyText = String.format(
                "Saga %d 在步骤 %s 失败。%n错误: %s%n重试: 在 /newstore/%d 点击重试按钮。",
                t.getId(), t.getSagaStep(), errorMessage == null ? "" : errorMessage, t.getId()
            );
            String bodyHtml = "<h3>" + subject + "</h3><p>" + bodyText.replace("\n", "<br/>") + "</p>";
            notificationDispatcher.notifyUser(userId, NotificationEventCode.NEW_STORE_FAIL, subject, bodyText, bodyHtml);
            log.info("[saga] NEW_STORE_FAIL notify dispatched taskId={} userId={}", t.getId(), userId);
        } catch (Exception e) {
            log.warn("[saga] NEW_STORE_FAIL notify failed taskId={} err={}", t.getId(), e.getMessage());
        }
    }

    /** 加载 ctx（供下一步读取）。 */
    public SagaContext loadContext(Long taskId) {
        Task t = requireTask(taskId);
        return deserializeContext(t.getSagaDataJson(), taskId, t.getTenantId());
    }

    /** 包装一个 step 执行：自动 advance 成功 / fail 失败。Step 实现写在 lambda 里。 */
    public void executeStep(Long taskId, SagaStep expected, java.util.function.Function<SagaContext, SagaContext> stepFn) {
        Task t = requireTask(taskId);
        if (!expected.name().equals(t.getSagaStep())) {
            throw new IllegalStateException("expected step " + expected + " but task is at " + t.getSagaStep());
        }
        SagaContext ctx = loadContext(taskId);
        try {
            SagaContext updated = stepFn.apply(ctx);
            advance(taskId, updated);
        } catch (Exception e) {
            fail(taskId, e.getMessage(), ctx);
            throw new SagaStepException(expected, e);
        }
    }

    private Task requireTask(Long taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null) throw new IllegalStateException("task not found: " + taskId);
        if (!"NEW_STORE_SAGA".equals(t.getType())) throw new IllegalStateException("not a saga task: " + taskId);
        return t;
    }

    private String serializeContext(SagaContext ctx) {
        try { return objectMapper.writeValueAsString(ctx); }
        catch (Exception e) { return "{}"; }
    }

    private SagaContext deserializeContext(String json, Long taskId, Long tenantId) {
        if (json == null || json.isBlank()) return SagaContext.empty(taskId, tenantId);
        try { return objectMapper.readValue(json, SagaContext.class); }
        catch (Exception e) {
            log.warn("saga ctx parse failed, returning empty: {}", e.getMessage());
            return SagaContext.empty(taskId, tenantId);
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
