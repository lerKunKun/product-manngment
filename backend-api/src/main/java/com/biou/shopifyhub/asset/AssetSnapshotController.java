package com.biou.shopifyhub.asset;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.asset.entity.AssetFile;
import com.biou.shopifyhub.asset.entity.AssetSnapshot;
import com.biou.shopifyhub.asset.mapper.AssetFileMapper;
import com.biou.shopifyhub.asset.mapper.AssetSnapshotMapper;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.file.FileService;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 资产快照查询接口（W2-AST-06）。
 *
 * <p>非阻塞约束：当 asset_snapshot/asset_file 表为空时，list 返回空 records，
 * detail/manifest 在数据缺失时返回友好的空对象，绝不抛 500。
 */
@RestController
@RequestMapping("/asset-snapshot")
public class AssetSnapshotController {

    private static final Logger log = LoggerFactory.getLogger(AssetSnapshotController.class);

    private final AssetSnapshotMapper snapshotMapper;
    private final AssetFileMapper fileMapper;
    private final FileService fileService;
    private final ObjectMapper objectMapper;
    private final StoreMapper storeMapper;

    public AssetSnapshotController(AssetSnapshotMapper snapshotMapper,
                                   AssetFileMapper fileMapper,
                                   FileService fileService,
                                   ObjectMapper objectMapper,
                                   StoreMapper storeMapper) {
        this.snapshotMapper = snapshotMapper;
        this.fileMapper = fileMapper;
        this.fileService = fileService;
        this.objectMapper = objectMapper;
        this.storeMapper = storeMapper;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<Map<String, Object>> list(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) Long storeId,
        @RequestParam(required = false) String snapshotType,
        @RequestParam(required = false) String status
    ) {
        LambdaQueryWrapper<AssetSnapshot> q = new LambdaQueryWrapper<>();
        if (storeId != null) q.eq(AssetSnapshot::getStoreId, storeId);
        if (snapshotType != null && !snapshotType.isBlank()) q.eq(AssetSnapshot::getSnapshotType, snapshotType);
        if (status != null && !status.isBlank()) q.eq(AssetSnapshot::getStatus, status);
        q.orderByDesc(AssetSnapshot::getId);

        Page<AssetSnapshot> p = snapshotMapper.selectPage(new Page<>(page, size), q);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("records", p.getRecords());
        resp.put("total", p.getTotal());
        resp.put("pageNo", p.getCurrent());
        resp.put("pageSize", p.getSize());
        return Result.ok(resp);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<Map<String, Object>> detail(@PathVariable Long id) {
        AssetSnapshot snap = snapshotMapper.selectById(id);
        Map<String, Object> resp = new LinkedHashMap<>();
        if (snap == null) {
            // Non-blocking: return empty wrapper so frontend can show "not found"
            resp.put("snapshot", null);
            resp.put("files", List.of());
            return Result.ok(resp);
        }
        LambdaQueryWrapper<AssetFile> fq = new LambdaQueryWrapper<>();
        fq.eq(AssetFile::getSnapshotId, id).orderByAsc(AssetFile::getRelativePath);
        List<AssetFile> files = fileMapper.selectList(fq);

        // Flatten snapshot fields + files into one object (consumer-friendly)
        resp.put("id", snap.getId());
        resp.put("tenantId", snap.getTenantId());
        resp.put("storeId", snap.getStoreId());
        resp.put("snapshotType", snap.getSnapshotType());
        resp.put("status", snap.getStatus());
        resp.put("r2Prefix", snap.getR2Prefix());
        resp.put("manifestJson", snap.getManifestJson());
        resp.put("fileCount", snap.getFileCount());
        resp.put("totalBytes", snap.getTotalBytes());
        resp.put("errorMessage", snap.getErrorMessage());
        resp.put("triggeredBy", snap.getTriggeredBy());
        resp.put("createdAt", snap.getCreatedAt());
        resp.put("startedAt", snap.getStartedAt());
        resp.put("completedAt", snap.getCompletedAt());
        resp.put("files", files);
        return Result.ok(resp);
    }

    /**
     * T10: 简化版触发资产快照——仅插入 PENDING 行，实际 worker 投递链路待 W2-AST 完整化。
     * 前端「批量拉资产」依赖此 endpoint，但当前 worker 不会自动消费。
     */
    @PostMapping("/trigger")
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<Long> trigger(@RequestBody TriggerReq req) {
        if (req == null || req.storeId == null) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "storeId required");
        }
        Store store = storeMapper.selectById(req.storeId);
        if (store == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "store " + req.storeId);
        }
        AssetSnapshot snap = new AssetSnapshot();
        snap.setTenantId(store.getTenantId());
        snap.setStoreId(req.storeId);
        snap.setSnapshotType(req.snapshotType != null && !req.snapshotType.isBlank() ? req.snapshotType : "FULL");
        snap.setStatus("PENDING");
        snap.setTriggeredBy(CurrentUser.userIdOrNull());
        snapshotMapper.insert(snap);
        log.warn("[asset-snapshot] trigger inserted PENDING id={} storeId={} type={}; "
            + "TODO 实际投 worker 链路待 W2-AST 完整化", snap.getId(), req.storeId, snap.getSnapshotType());
        return Result.ok(snap.getId());
    }

    public static class TriggerReq {
        public Long storeId;
        public String snapshotType;
    }

    /**
     * T22: 取消 PENDING/RUNNING 快照。CANCELED 已通过 V25 加入 asset_snapshot.status 枚举。
     */
    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<Void> cancel(@PathVariable Long id) {
        AssetSnapshot s = snapshotMapper.selectById(id);
        if (s == null) throw new BusinessException(ResultCode.NOT_FOUND, "snapshot " + id);
        if (!"PENDING".equals(s.getStatus()) && !"RUNNING".equals(s.getStatus())) {
            throw new BusinessException(ResultCode.CONFLICT, "仅 PENDING/RUNNING 可取消，当前 status=" + s.getStatus());
        }
        s.setStatus("CANCELED");
        snapshotMapper.updateById(s);
        log.info("[asset-snapshot] cancel id={}", id);
        return Result.ok();
    }

    @GetMapping("/{id}/manifest")
    @PreAuthorize("hasAuthority('PERM_THEME:PULL')")
    public Result<Map<String, Object>> manifest(@PathVariable Long id) {
        AssetSnapshot snap = snapshotMapper.selectById(id);
        if (snap == null) {
            return Result.error(404, "snapshot not found: " + id);
        }
        String prefix = snap.getR2Prefix();
        if (prefix == null || prefix.isBlank()) {
            return Result.error(404, "snapshot has no r2Prefix yet (status=" + snap.getStatus() + ")");
        }
        if (!prefix.endsWith("/")) prefix = prefix + "/";
        String key = prefix + "manifest.json";
        try {
            byte[] data = fileService.downloadBytes(key);
            Map<String, Object> parsed = objectMapper.readValue(data, new TypeReference<Map<String, Object>>() {});
            return Result.ok(parsed);
        } catch (Exception e) {
            log.warn("asset-snapshot manifest load failed id={} key={} err={}", id, key, e.getMessage());
            return Result.error(500, "manifest load failed: " + e.getMessage());
        }
    }
}
