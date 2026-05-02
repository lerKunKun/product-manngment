package com.biou.shopifyhub.push;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.push.entity.PushConflict;
import com.biou.shopifyhub.push.entity.StoreProduct;
import com.biou.shopifyhub.push.entity.Task;
import com.biou.shopifyhub.push.mapper.PushConflictMapper;
import com.biou.shopifyhub.push.mapper.StoreProductMapper;
import com.biou.shopifyhub.push.mapper.TaskMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 通用任务（task）查询接口（W2-PUSH-06）。
 *
 * <p>列表 / 详情 / payload 三个 GET 端点，所有写入仍由 {@link PushService} 等业务侧负责。
 * 列表故意不返回 payload_json / result_json 这两个 LONGTEXT 字段以保持轻量；
 * 详情默认也不带 payload，前端按 tab 懒加载 {@code GET /task/{id}/payload}。
 *
 * <p>分页基于已注入的 {@code PaginationInnerInterceptor}（见 MybatisPlusConfig）。
 */
@RestController
@RequestMapping("/task")
public class TaskController {

    private static final Logger log = LoggerFactory.getLogger(TaskController.class);
    private static final int ERROR_TRUNCATE_LEN = 200;
    private static final int CONFLICT_LIMIT = 10;

    private final TaskMapper taskMapper;
    private final StoreProductMapper storeProductMapper;
    private final PushConflictMapper conflictMapper;
    private final ObjectMapper objectMapper;

    public TaskController(TaskMapper taskMapper,
                          StoreProductMapper storeProductMapper,
                          PushConflictMapper conflictMapper,
                          ObjectMapper objectMapper) {
        this.taskMapper = taskMapper;
        this.storeProductMapper = storeProductMapper;
        this.conflictMapper = conflictMapper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public Result<Map<String, Object>> list(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) String type,
        @RequestParam(required = false) String status,
        @RequestParam(required = false) Long storeId
    ) {
        LambdaQueryWrapper<Task> q = new LambdaQueryWrapper<>();
        if (type != null && !type.isBlank()) q.eq(Task::getType, type);
        if (status != null && !status.isBlank()) q.eq(Task::getStatus, status);
        if (storeId != null) q.eq(Task::getStoreId, storeId);
        q.orderByDesc(Task::getId);

        Page<Task> p = taskMapper.selectPage(new Page<>(page, size), q);
        List<Map<String, Object>> records = p.getRecords().stream()
            .map(TaskController::toListItem)
            .toList();

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("records", records);
        resp.put("total", p.getTotal());
        resp.put("pageNo", p.getCurrent());
        resp.put("pageSize", p.getSize());
        return Result.ok(resp);
    }

    @GetMapping("/{id}")
    public Result<Map<String, Object>> detail(@PathVariable Long id) {
        Task t = taskMapper.selectById(id);
        Map<String, Object> resp = new LinkedHashMap<>();
        if (t == null) {
            resp.put("task", null);
            resp.put("storeProduct", null);
            resp.put("pushConflicts", List.of());
            return Result.ok(resp);
        }
        // 平铺 task 字段（与列表 item 同构 + 多带 errorMessage 完整版）
        resp.putAll(toDetailRow(t));

        // 关联 store_product：PRODUCT_PUSH 时优先用 payload 顶层 productId 直查，
        // 否则回落 last_push_task_id 反查（兼容 tech debt #9 之前的旧 task 行）。
        StoreProduct sp = null;
        if ("PRODUCT_PUSH".equals(t.getType()) && t.getStoreId() != null) {
            Long productId = null;
            if (t.getPayloadJson() != null) {
                try {
                    Map<String, Object> payload = objectMapper.readValue(
                        t.getPayloadJson(), new TypeReference<Map<String, Object>>() {});
                    Object pid = payload.get("productId");
                    if (pid instanceof Number n) productId = n.longValue();
                } catch (Exception e) {
                    log.debug("[task] payload parse failed taskId={} err={}", id, e.getMessage());
                }
            }
            if (productId != null) {
                sp = storeProductMapper.selectOne(
                    new LambdaQueryWrapper<StoreProduct>()
                        .eq(StoreProduct::getStoreId, t.getStoreId())
                        .eq(StoreProduct::getProductId, productId)
                        .last("LIMIT 1")
                );
            }
            if (sp == null) {
                // 旧行兜底：按 last_push_task_id 反查
                sp = storeProductMapper.selectOne(
                    new LambdaQueryWrapper<StoreProduct>()
                        .eq(StoreProduct::getLastPushTaskId, id)
                        .last("LIMIT 1")
                );
            }
        }
        resp.put("storeProduct", sp);

        // 关联冲突（最近 10 条）
        List<PushConflict> conflicts = conflictMapper.selectList(
            new LambdaQueryWrapper<PushConflict>()
                .eq(PushConflict::getTaskId, id)
                .orderByDesc(PushConflict::getId)
                .last("LIMIT " + CONFLICT_LIMIT)
        );
        resp.put("pushConflicts", conflicts);
        return Result.ok(resp);
    }

    @GetMapping("/{id}/payload")
    public Result<Map<String, Object>> payload(@PathVariable Long id) {
        Task t = taskMapper.selectById(id);
        Map<String, Object> resp = new LinkedHashMap<>();
        if (t == null) {
            resp.put("payloadJson", null);
            resp.put("payload", null);
            resp.put("resultJson", null);
            resp.put("result", null);
            return Result.ok(resp);
        }
        resp.put("payloadJson", t.getPayloadJson());
        resp.put("resultJson", t.getResultJson());
        // 解析后的对象（前端 pretty-print 用）；解析失败回退到 raw 字符串。
        if (t.getPayloadJson() != null && !t.getPayloadJson().isBlank()) {
            try {
                resp.put("payload", objectMapper.readValue(
                    t.getPayloadJson(), new TypeReference<Object>() {}));
            } catch (Exception e) {
                resp.put("payload", null);
            }
        } else {
            resp.put("payload", null);
        }
        if (t.getResultJson() != null && !t.getResultJson().isBlank()) {
            try {
                resp.put("result", objectMapper.readValue(
                    t.getResultJson(), new TypeReference<Object>() {}));
            } catch (Exception e) {
                resp.put("result", null);
            }
        } else {
            resp.put("result", null);
        }
        return Result.ok(resp);
    }

    // -------------------------------------------------------------- mapping helpers

    /** 列表 item：剔除 payload/result 大字段，截断 errorMessage。 */
    private static Map<String, Object> toListItem(Task t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.getId());
        m.put("tenantId", t.getTenantId());
        m.put("type", t.getType());
        m.put("status", t.getStatus());
        m.put("storeId", t.getStoreId());
        m.put("errorMessage", truncate(t.getErrorMessage(), ERROR_TRUNCATE_LEN));
        m.put("triggeredBy", t.getTriggeredBy());
        m.put("parentTaskId", t.getParentTaskId());
        m.put("createdAt", t.getCreatedAt());
        m.put("startedAt", t.getStartedAt());
        m.put("completedAt", t.getCompletedAt());
        return m;
    }

    /** 详情 row：与 list item 对齐，errorMessage 不截断。 */
    private static Map<String, Object> toDetailRow(Task t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.getId());
        m.put("tenantId", t.getTenantId());
        m.put("type", t.getType());
        m.put("status", t.getStatus());
        m.put("storeId", t.getStoreId());
        m.put("errorMessage", t.getErrorMessage());
        m.put("triggeredBy", t.getTriggeredBy());
        m.put("parentTaskId", t.getParentTaskId());
        m.put("createdAt", t.getCreatedAt());
        m.put("startedAt", t.getStartedAt());
        m.put("completedAt", t.getCompletedAt());
        return m;
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
