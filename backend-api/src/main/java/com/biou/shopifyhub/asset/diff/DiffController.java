package com.biou.shopifyhub.asset.diff;

import com.biou.shopifyhub.asset.diff.dto.ContentDiffResult;
import com.biou.shopifyhub.asset.diff.dto.ManifestDiffResult;
import com.biou.shopifyhub.asset.diff.entity.SnapshotDiffCache;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 跨店 / 历史快照 diff endpoints（AS4）。
 *
 * <p>权限和 AS1 resync 一致：{@code PERM_THEME:PULL}（看快照 = 看资产读权限）。
 *
 * <p>route 总览：
 * <ul>
 *   <li>{@code POST /diff/snapshot} body {@link DiffRequest} — manifest diff（按 cache）</li>
 *   <li>{@code GET  /diff/snapshot?a&b&scope} — 同上的 GET 版（前端直链可分享）</li>
 *   <li>{@code POST /diff/snapshot/content} body {@link ContentDiffRequest} — 内容层 diff</li>
 *   <li>{@code GET  /diff/snapshot/{id}} — 取缓存详情</li>
 * </ul>
 */
@RestController
@RequestMapping("/diff")
public class DiffController {

    private static final Logger log = LoggerFactory.getLogger(DiffController.class);

    private final DiffService diffService;

    public DiffController(DiffService diffService) {
        this.diffService = diffService;
    }

    @PostMapping("/snapshot")
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<ManifestDiffResult> diffSnapshot(@RequestBody DiffRequest req) {
        validatePair(req == null ? null : req.snapshotAId, req == null ? null : req.snapshotBId);
        String scope = (req.scope == null || req.scope.isBlank()) ? DiffService.SCOPE_MANIFEST : req.scope;
        if (!DiffService.SCOPE_MANIFEST.equals(scope)) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "scope=" + scope + " not supported via /diff/snapshot; use /diff/snapshot/content for file-level");
        }
        ManifestDiffResult r = diffService.getOrComputeManifestDiff(req.snapshotAId, req.snapshotBId);
        log.info("[diff] POST /diff/snapshot a={} b={} +{} -{} ~{} cached={}",
            req.snapshotAId, req.snapshotBId, r.summary.added, r.summary.removed, r.summary.modified, r.cached);
        return Result.ok(r);
    }

    @GetMapping("/snapshot")
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<ManifestDiffResult> diffSnapshotGet(@RequestParam("a") Long a,
                                                      @RequestParam("b") Long b,
                                                      @RequestParam(value = "scope", required = false) String scope) {
        DiffRequest req = new DiffRequest();
        req.snapshotAId = a;
        req.snapshotBId = b;
        req.scope = scope;
        return diffSnapshot(req);
    }

    @PostMapping("/snapshot/content")
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<ContentDiffResult> diffContent(@RequestBody ContentDiffRequest req) {
        validatePair(req == null ? null : req.snapshotAId, req == null ? null : req.snapshotBId);
        if (req.paths == null || req.paths.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "paths must not be empty");
        }
        if (req.paths.size() > 50) {
            // 防呆：单次最多 50 个文件 diff，避免 worker 长时间阻塞
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "too many paths (" + req.paths.size() + " > 50)");
        }
        ContentDiffResult r = diffService.computeContentDiff(req.snapshotAId, req.snapshotBId, req.paths);
        return Result.ok(r);
    }

    @GetMapping("/snapshot/{id}")
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<Map<String, Object>> getCache(@PathVariable Long id) {
        SnapshotDiffCache row = diffService.getCacheById(id);
        if (row == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "diff cache " + id);
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("id", row.getId());
        resp.put("snapshotAId", row.getSnapshotAId());
        resp.put("snapshotBId", row.getSnapshotBId());
        resp.put("scope", row.getScope());
        resp.put("computedAt", row.getComputedAt());
        resp.put("resultJson", row.getResultJson());
        return Result.ok(resp);
    }

    private static void validatePair(Long a, Long b) {
        if (a == null || b == null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "snapshotAId / snapshotBId required");
        }
        if (a.equals(b)) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "snapshotAId == snapshotBId: nothing to diff");
        }
    }

    public static class DiffRequest {
        public Long snapshotAId;
        public Long snapshotBId;
        public String scope;
    }

    public static class ContentDiffRequest {
        public Long snapshotAId;
        public Long snapshotBId;
        public List<String> paths;
    }
}
