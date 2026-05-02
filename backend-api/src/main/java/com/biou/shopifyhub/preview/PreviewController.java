package com.biou.shopifyhub.preview;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.preview.entity.PreviewTheme;
import com.biou.shopifyhub.preview.mapper.PreviewThemeMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * W3-PV-03 / W3-PV-05：分配 preview_theme 并同步驱动 worker 构建。
 *
 * <p>{@link #allocate} 现在做两件事：
 * <ol>
 *   <li>{@link PreviewThemeAllocator#allocate} 选店 + 插入 PENDING 行（事务内）。</li>
 *   <li>{@link PreviewBuildOrchestrator#build} 同步调用 worker {@code POST /preview/build}，
 *       回填 shopify_theme_id / preview_url / status。</li>
 * </ol>
 * orchestrator 内部捕获所有异常并写 FAILED；这里二次 try/catch 兜底，确保即便
 * orchestrator 自身崩溃也不会抛出 5xx——前端总能拿到一行 PreviewTheme，
 * 据 status 决定下一步（READY 直接打开 / FAILED 显示错误 / PENDING|BUILDING 提示稍后再查）。
 */
@RestController
@RequestMapping("/preview")
public class PreviewController {

    private static final Logger log = LoggerFactory.getLogger(PreviewController.class);

    private final PreviewThemeAllocator allocator;
    private final PreviewThemeMapper previewMapper;
    private final PreviewBuildOrchestrator orchestrator;

    public PreviewController(PreviewThemeAllocator allocator,
                             PreviewThemeMapper previewMapper,
                             PreviewBuildOrchestrator orchestrator) {
        this.allocator = allocator;
        this.previewMapper = previewMapper;
        this.orchestrator = orchestrator;
    }

    /** Allocate a preview slot + drive worker build. Returns the row reflecting the latest status. */
    @PostMapping
    public Result<PreviewTheme> allocate(@RequestBody AllocateRequest req) {
        PreviewTheme p = allocator.allocate(req.tenantId(), req.sourceProductId());
        try {
            orchestrator.build(p);
        } catch (Exception e) {
            // orchestrator already swallows; this is belt-and-suspenders so the row
            // is always returned even if some unexpected throwable escapes.
            log.error("[preview] orchestrator escaped exception id={} err={}", p.getId(), e.getMessage(), e);
        }
        // Re-load to get the latest status/url written by the orchestrator.
        PreviewTheme latest = previewMapper.selectById(p.getId());
        return Result.ok(latest != null ? latest : p);
    }

    @GetMapping("/{id}")
    public Result<PreviewTheme> get(@PathVariable Long id) {
        PreviewTheme p = previewMapper.selectById(id);
        if (p == null) return Result.error(40404, "preview not found");
        return Result.ok(p);
    }

    @GetMapping
    public Result<List<PreviewTheme>> list(@RequestParam(required = false) Long sourceProductId,
                                           @RequestParam(required = false) Long devStoreId,
                                           @RequestParam(required = false) String status) {
        LambdaQueryWrapper<PreviewTheme> q = new LambdaQueryWrapper<PreviewTheme>()
            .orderByDesc(PreviewTheme::getCreatedAt);
        if (sourceProductId != null) q.eq(PreviewTheme::getSourceProductId, sourceProductId);
        if (devStoreId != null) q.eq(PreviewTheme::getDevStoreId, devStoreId);
        if (status != null) q.eq(PreviewTheme::getStatus, status);
        return Result.ok(previewMapper.selectList(q));
    }

    /** Mark accessed (frontend calls this when user opens the preview URL). */
    @PostMapping("/{id}/accessed")
    public Result<Void> markAccessed(@PathVariable Long id) {
        allocator.markAccessed(id);
        return Result.ok();
    }

    public record AllocateRequest(Long tenantId, Long sourceProductId) {}
}
