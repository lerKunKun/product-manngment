package com.biou.shopifyhub.push;

import com.biou.shopifyhub.core.Result;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * REST entrypoint for product push (W2-PUSH-04 / W2-PUSH-05).
 *
 * <p>Returns the persisted {@code task} id; callers poll task status
 * separately. Day 6 is synchronous: the HTTP response only comes back after
 * the worker call completes. The batch endpoint added in W2-PUSH-05 is also
 * synchronous (a loop over single-product pushes) — see Wave2-配置占位.md
 * §14 for the limitation note and the future async/queue plan.
 *
 * <p>TODO(W1-RBAC): currently all routes are {@code permitAll()} via
 * {@code SecurityConfig}. Once RBAC ships, gate these endpoints on the
 * {@code PRODUCT:PUSH} permission and resolve {@code triggeredBy} from the
 * authenticated principal instead of the request body.
 */
@RestController
@RequestMapping("/push")
public class PushController {

    private final PushService pushService;

    public PushController(PushService pushService) {
        this.pushService = pushService;
    }

    @PostMapping("/product")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:PUSH')")
    public Result<Map<String, Object>> push(@RequestBody PushRequest req) {
        Long taskId = pushService.push(req.productId(), req.storeId(), req.triggeredBy());
        return Result.ok(Map.of("taskId", taskId));
    }

    /**
     * Batch push: loop over {@code productIds} sequentially, link sub-tasks
     * to a single parent task via {@code parent_task_id} (W2-PUSH-05).
     */
    @PostMapping("/batch")
    @PreAuthorize("hasAuthority('PERM_PRODUCT:PUSH')")
    public Result<Map<String, Object>> batch(@RequestBody BatchPushRequest req) {
        PushService.BatchResult r = pushService.pushBatch(
            req.productIds(), req.storeId(), req.triggeredBy());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("parentTaskId", r.parentTaskId());
        resp.put("subTaskIds", r.subTaskIds());
        resp.put("summary", Map.of(
            "success", r.success(),
            "failed", r.failed(),
            "partial", r.partial()
        ));
        return Result.ok(resp);
    }

    public record PushRequest(long productId, long storeId, Long triggeredBy) {}
    public record BatchPushRequest(List<Long> productIds, long storeId, Long triggeredBy) {}
}
