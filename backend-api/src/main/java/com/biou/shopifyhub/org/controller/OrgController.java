package com.biou.shopifyhub.org.controller;

import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.org.dingtalk.DingTalkConfigService;
import com.biou.shopifyhub.org.dingtalk.DingTalkSyncService;
import com.biou.shopifyhub.org.entity.SysOrg;
import com.biou.shopifyhub.org.service.OrgService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/org")
public class OrgController {

    private static final Logger log = LoggerFactory.getLogger(OrgController.class);

    private final OrgService service;
    private final DingTalkConfigService configService;
    private final DingTalkSyncService syncService;

    public OrgController(OrgService service,
                         DingTalkConfigService configService,
                         DingTalkSyncService syncService) {
        this.service = service;
        this.configService = configService;
        this.syncService = syncService;
    }

    @GetMapping("/tree")
    public Result<List<Map<String, Object>>> tree() {
        return Result.ok(service.tree());
    }

    @GetMapping
    public Result<List<SysOrg>> list() {
        return Result.ok(service.listAll());
    }

    @PostMapping
    public Result<Map<String, Long>> create(@RequestBody SysOrg input) {
        Long id = service.create(input);
        // 创建成功后：若该组织（COMPANY）已配置钉钉，异步触发一次同步
        if (input != null && "COMPANY".equalsIgnoreCase(input.getType()) && syncService.isConfigured(id)) {
            triggerSyncAsync(id, "CREATE_ORG");
        }
        return Result.ok(Map.of("id", id));
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody SysOrg patch) {
        service.update(id, patch);
        return Result.ok();
    }

    /** 删除组织节点是危险操作，需走二次确认 */
    @RequireSensitiveOp("ORG_DELETE")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        service.softDelete(id);
        return Result.ok();
    }

    // ============================================================
    // F1 / F2 / F3：钉钉配置 + 同步
    // ============================================================

    @GetMapping("/{id}/dingtalk-config")
    public Result<Map<String, Object>> getDingtalkConfig(@PathVariable Long id) {
        return Result.ok(configService.viewSafe(id));
    }

    @PutMapping("/{id}/dingtalk-config")
    public Result<Void> saveDingtalkConfig(@PathVariable Long id,
                                           @RequestBody DingTalkConfigService.SaveConfigCmd cmd) {
        configService.save(id, cmd);
        return Result.ok();
    }

    /** 立即同步（同步调用，前端 loading 中）。 */
    @PostMapping("/{id}/sync")
    public Result<Map<String, Object>> sync(@PathVariable Long id) {
        DingTalkSyncService.SyncResult r = syncService.syncAll(id, "MANUAL");
        Map<String, Object> view = new HashMap<>();
        view.put("added", r.added());
        view.put("skipped", r.skipped());
        view.put("failed", r.failed());
        view.put("errorMsg", r.errorMsg());
        return Result.ok(view);
    }

    /**
     * 用守护线程"打了就走"，建组织响应不阻塞钉钉同步耗时。
     * （没有走 @Async：避免 self-invocation 不被 Spring 代理拦截到的坑）
     */
    private void triggerSyncAsync(Long orgId, String triggerSource) {
        Thread t = new Thread(() -> {
            try {
                syncService.syncAll(orgId, triggerSource);
            } catch (Exception e) {
                log.warn("[dingtalk-sync] async-trigger failed orgId={} src={} err={}",
                    orgId, triggerSource, e.getMessage());
            }
        }, "dingtalk-sync-create-" + orgId);
        t.setDaemon(true);
        t.start();
    }
}
