package com.biou.shopifyhub.asset;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.asset.entity.AssetFile;
import com.biou.shopifyhub.asset.entity.AssetSnapshot;
import com.biou.shopifyhub.asset.mapper.AssetFileMapper;
import com.biou.shopifyhub.asset.mapper.AssetSnapshotMapper;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.file.FileService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    public AssetSnapshotController(AssetSnapshotMapper snapshotMapper,
                                   AssetFileMapper fileMapper,
                                   FileService fileService,
                                   ObjectMapper objectMapper) {
        this.snapshotMapper = snapshotMapper;
        this.fileMapper = fileMapper;
        this.fileService = fileService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
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

    @GetMapping("/{id}/manifest")
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
