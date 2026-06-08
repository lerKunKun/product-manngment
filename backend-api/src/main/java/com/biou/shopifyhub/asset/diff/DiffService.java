package com.biou.shopifyhub.asset.diff;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.asset.diff.dto.ContentDiffResult;
import com.biou.shopifyhub.asset.diff.dto.DiffChange;
import com.biou.shopifyhub.asset.diff.dto.DiffSummary;
import com.biou.shopifyhub.asset.diff.dto.ManifestDiffResult;
import com.biou.shopifyhub.asset.diff.entity.SnapshotDiffCache;
import com.biou.shopifyhub.asset.diff.mapper.SnapshotDiffCacheMapper;
import com.biou.shopifyhub.asset.entity.AssetSnapshot;
import com.biou.shopifyhub.asset.mapper.AssetSnapshotMapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.file.FileService;
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
import java.time.LocalDateTime;
import java.util.*;

/**
 * 跨店 / 历史快照 diff 引擎（AS4）。
 *
 * <p>三层选型（评估文档 §2.3）：
 * <ol>
 *   <li><b>manifest 层</b>：拉两份 {@code manifest.json}（schema = AS2 manifest_writer），按
 *       {@code relative_path} 左外连接 → ADDED/REMOVED/MODIFIED/UNCHANGED；
 *       MODIFIED 判定 = sha256 不同。返回时 filter 掉 UNCHANGED。</li>
 *   <li><b>内容层（文本）</b>：把要看 diff 的 path 列表转交给 worker {@code POST /diff/content}，
 *       worker 走 CAS 拿字节后用 {@code difflib.unified_diff} 生成预览（最多 50 行）。</li>
 *   <li><b>内容层（二进制）</b>：worker 不算字节 diff，仅返回 {@code BINARY_ONLY} + 大小变化。</li>
 * </ol>
 *
 * <p>结果按 {@code (snapshot_a_id, snapshot_b_id, scope)} 存
 * {@code snapshot_diff_cache}（V38）。命中即返回，避免重复算。
 */
@Service
public class DiffService {

    private static final Logger log = LoggerFactory.getLogger(DiffService.class);

    public static final String SCOPE_MANIFEST = "manifest";

    private final SnapshotDiffCacheMapper cacheMapper;
    private final AssetSnapshotMapper snapshotMapper;
    private final FileService fileService;
    private final ObjectMapper objectMapper;

    @Value("${shopify.worker.base-url:http://localhost:8765}")
    private String workerBaseUrl;

    @Value("${shopify.worker.call-timeout-seconds:120}")
    private long workerTimeoutSeconds;

    @Value("${shopify.worker.token:}")
    private String workerToken;

    public DiffService(SnapshotDiffCacheMapper cacheMapper,
                       AssetSnapshotMapper snapshotMapper,
                       FileService fileService,
                       ObjectMapper objectMapper) {
        this.cacheMapper = cacheMapper;
        this.snapshotMapper = snapshotMapper;
        this.fileService = fileService;
        this.objectMapper = objectMapper;
    }

    // ================================================================ public API

    /**
     * Manifest 一层 diff：先查 cache → 命中即返回；未命中拉两份 manifest 现算后回写缓存。
     */
    public ManifestDiffResult getOrComputeManifestDiff(long snapshotAId, long snapshotBId) {
        SnapshotDiffCache hit = findCache(snapshotAId, snapshotBId, SCOPE_MANIFEST);
        if (hit != null) {
            try {
                ManifestDiffResult cached = objectMapper.readValue(hit.getResultJson(),
                    ManifestDiffResult.class);
                cached.cached = true;
                return cached;
            } catch (Exception e) {
                log.warn("[diff] cache deserialize failed id={} err={}, recomputing",
                    hit.getId(), e.getMessage());
            }
        }
        ManifestDiffResult fresh = computeManifestDiff(snapshotAId, snapshotBId);
        try {
            String json = objectMapper.writeValueAsString(fresh);
            writeCache(snapshotAId, snapshotBId, SCOPE_MANIFEST, json);
        } catch (Exception e) {
            log.warn("[diff] cache write failed snapA={} snapB={} err={}",
                snapshotAId, snapshotBId, e.getMessage());
        }
        return fresh;
    }

    /**
     * 现算 manifest diff，不查 cache、不写 cache。
     *
     * <p>流程：load(A.manifest) + load(B.manifest) → 按 relative_path 左外连接
     * → 输出 ADDED/REMOVED/MODIFIED/UNCHANGED → 过滤 UNCHANGED。
     */
    public ManifestDiffResult computeManifestDiff(long snapshotAId, long snapshotBId) {
        Map<String, ManifestEntry> a = loadManifestEntries(snapshotAId);
        Map<String, ManifestEntry> b = loadManifestEntries(snapshotBId);

        ManifestDiffResult result = new ManifestDiffResult();
        DiffSummary summary = new DiffSummary(snapshotAId, snapshotBId);

        // union of keys, deterministic order for cache stability
        Set<String> allKeys = new TreeSet<>();
        allKeys.addAll(a.keySet());
        allKeys.addAll(b.keySet());

        for (String path : allKeys) {
            ManifestEntry left = a.get(path);
            ManifestEntry right = b.get(path);
            String category = inferCategory(path);
            if (left == null && right != null) {
                DiffChange c = new DiffChange("ADDED", category, path);
                c.shaB = right.sha256;
                c.sizeB = right.size;
                c.contentType = right.contentType;
                result.changes.add(c);
                summary.added++;
            } else if (left != null && right == null) {
                DiffChange c = new DiffChange("REMOVED", category, path);
                c.shaA = left.sha256;
                c.sizeA = left.size;
                c.contentType = left.contentType;
                result.changes.add(c);
                summary.removed++;
            } else if (left != null && right != null) {
                if (Objects.equals(left.sha256, right.sha256)) {
                    summary.unchanged++;
                    // filter out UNCHANGED — frontend only renders deltas
                } else {
                    DiffChange c = new DiffChange("MODIFIED", category, path);
                    c.shaA = left.sha256;
                    c.shaB = right.sha256;
                    c.sizeA = left.size;
                    c.sizeB = right.size;
                    c.contentType = right.contentType != null ? right.contentType : left.contentType;
                    result.changes.add(c);
                    summary.modified++;
                }
            }
        }
        result.summary = summary;
        result.cached = false;
        log.info("[diff] manifest computed snapA={} snapB={} +{} -{} ~{} ={}",
            snapshotAId, snapshotBId, summary.added, summary.removed, summary.modified,
            summary.unchanged);
        return result;
    }

    /**
     * 内容层 diff：调 worker {@code POST /diff/content} 拿到 unified_diff 列表。
     *
     * <p>不走整体 manifest 缓存（行数太多），改按 {@code (snapA, snapB, "content:<path>")}
     * 单文件维度做，可被多次复用。
     */
    public ContentDiffResult computeContentDiff(long snapshotAId, long snapshotBId, List<String> paths) {
        if (paths == null || paths.isEmpty()) {
            ContentDiffResult empty = new ContentDiffResult();
            empty.snapshotAId = snapshotAId;
            empty.snapshotBId = snapshotBId;
            return empty;
        }
        AssetSnapshot snapA = requireSnapshot(snapshotAId);
        AssetSnapshot snapB = requireSnapshot(snapshotBId);
        if (!Objects.equals(snapA.getTenantId(), snapB.getTenantId())) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "snapshots cross-tenant content diff not supported (A.tenant=" + snapA.getTenantId()
                    + ", B.tenant=" + snapB.getTenantId() + ")");
        }
        // assemble payload for worker
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("tenant_id", snapA.getTenantId());
        body.put("snapshot_a_prefix", snapA.getR2Prefix());
        body.put("snapshot_b_prefix", snapB.getR2Prefix());
        body.put("paths", paths);

        ContentDiffResult result = new ContentDiffResult();
        result.snapshotAId = snapshotAId;
        result.snapshotBId = snapshotBId;

        Map<String, Object> resp;
        try {
            resp = callWorker("/diff/content", body);
        } catch (IOException e) {
            log.warn("[diff] worker /diff/content failed: {}", e.getMessage());
            // graceful degrade: return entries with error preview rather than 500
            for (String p : paths) {
                DiffChange c = new DiffChange("MODIFIED", inferCategory(p), p);
                c.diffPreview = "[worker call failed: " + e.getMessage() + "]";
                result.items.add(c);
            }
            return result;
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = resp == null ? List.of()
            : (List<Map<String, Object>>) resp.getOrDefault("items", List.of());
        for (Map<String, Object> it : items) {
            String path = String.valueOf(it.getOrDefault("path", ""));
            DiffChange c = new DiffChange();
            c.path = path;
            c.category = inferCategory(path);
            c.kind = String.valueOf(it.getOrDefault("kind", "MODIFIED"));
            c.diffPreview = (String) it.get("preview");
            c.sizeA = asLongOrNull(it.get("size_a"));
            c.sizeB = asLongOrNull(it.get("size_b"));
            c.shaA = (String) it.get("sha_a");
            c.shaB = (String) it.get("sha_b");
            c.contentType = (String) it.get("content_type");

            // per-file cache
            String scope = "content:" + path;
            try {
                String json = objectMapper.writeValueAsString(c);
                writeCache(snapshotAId, snapshotBId, scope, json);
            } catch (Exception e) {
                log.debug("[diff] content cache write skipped path={} err={}", path, e.getMessage());
            }
            result.items.add(c);
        }
        return result;
    }

    /** 取缓存详情 — 给 GET /diff/snapshot/{id} 用。 */
    public SnapshotDiffCache getCacheById(long id) {
        return cacheMapper.selectById(id);
    }

    // ================================================================== internals

    private SnapshotDiffCache findCache(long a, long b, String scope) {
        LambdaQueryWrapper<SnapshotDiffCache> q = new LambdaQueryWrapper<SnapshotDiffCache>()
            .eq(SnapshotDiffCache::getSnapshotAId, a)
            .eq(SnapshotDiffCache::getSnapshotBId, b)
            .eq(SnapshotDiffCache::getScope, scope)
            .orderByDesc(SnapshotDiffCache::getId)
            .last("LIMIT 1");
        return cacheMapper.selectOne(q);
    }

    private void writeCache(long a, long b, String scope, String json) {
        SnapshotDiffCache existing = findCache(a, b, scope);
        if (existing != null) {
            existing.setResultJson(json);
            existing.setComputedAt(LocalDateTime.now());
            cacheMapper.updateById(existing);
            return;
        }
        SnapshotDiffCache row = new SnapshotDiffCache();
        row.setSnapshotAId(a);
        row.setSnapshotBId(b);
        row.setScope(scope);
        row.setResultJson(json);
        row.setComputedAt(LocalDateTime.now());
        try {
            cacheMapper.insert(row);
        } catch (Exception e) {
            // unique key race — fall back to update path
            log.debug("[diff] insert race on uk_pair_scope, retry update: {}", e.getMessage());
            SnapshotDiffCache after = findCache(a, b, scope);
            if (after != null) {
                after.setResultJson(json);
                after.setComputedAt(LocalDateTime.now());
                cacheMapper.updateById(after);
            }
        }
    }

    /**
     * 拉一份 manifest.json 并解析成 {@code Map<relative_path, entry>}。
     *
     * <p>读路径同 {@code AssetSnapshotController.manifest()}：
     * 用 {@link FileService#downloadBytes} 直读 R2/MinIO（不走 worker），key =
     * {@code asset_snapshot.r2_prefix + "manifest.json"}。
     *
     * <p>快照不存在 / 没 prefix / manifest 文件本身缺失 → 抛业务异常给上层映射。
     */
    Map<String, ManifestEntry> loadManifestEntries(long snapshotId) {
        AssetSnapshot snap = requireSnapshot(snapshotId);
        String prefix = snap.getR2Prefix();
        if (prefix == null || prefix.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED,
                "snapshot " + snapshotId + " has no r2Prefix (status=" + snap.getStatus() + ")");
        }
        if (!prefix.endsWith("/")) prefix = prefix + "/";
        String key = prefix + "manifest.json";
        byte[] bytes;
        try {
            bytes = fileService.downloadBytes(key);
        } catch (IOException e) {
            throw new BusinessException(ResultCode.NOT_FOUND,
                "manifest not found for snapshot " + snapshotId + ": " + e.getMessage());
        }
        return parseManifest(bytes);
    }

    /**
     * 解析 manifest 字节 → 索引成 {@code Map<relative_path, entry>}。
     *
     * <p>容忍 entries 缺失 / 个别 entry 缺字段（跳过空 path）。
     */
    Map<String, ManifestEntry> parseManifest(byte[] bytes) {
        try {
            Map<String, Object> root = objectMapper.readValue(bytes,
                new TypeReference<Map<String, Object>>() {});
            Object entriesObj = root.get("entries");
            if (!(entriesObj instanceof List<?> entries)) {
                return Map.of();
            }
            Map<String, ManifestEntry> out = new LinkedHashMap<>();
            for (Object o : entries) {
                if (!(o instanceof Map<?, ?> map)) continue;
                String relPath = stringOrNull(map.get("relative_path"));
                if (relPath == null || relPath.isBlank()) continue;
                ManifestEntry e = new ManifestEntry();
                e.relativePath = relPath;
                e.sha256 = stringOrNull(map.get("sha256"));
                e.contentType = stringOrNull(map.get("content_type"));
                Object sizeObj = map.get("size");
                if (sizeObj instanceof Number n) {
                    e.size = n.longValue();
                }
                out.put(relPath, e);
            }
            return out;
        } catch (Exception e) {
            log.warn("[diff] parse manifest failed: {}", e.getMessage());
            throw new BusinessException(ResultCode.INTERNAL_ERROR,
                "manifest json parse failed: " + e.getMessage());
        }
    }

    private AssetSnapshot requireSnapshot(long id) {
        AssetSnapshot s = snapshotMapper.selectById(id);
        if (s == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "snapshot " + id);
        }
        return s;
    }

    /**
     * 从 relative_path 第一段推断大类。manifest 写入端约定（worker 各 *_pull.py）：
     * <ul>
     *   <li>{@code theme/}, {@code templates/}, {@code sections/}, {@code config/}, {@code assets/}, {@code locales/}, {@code snippets/} → theme</li>
     *   <li>{@code products/} → products</li>
     *   <li>{@code policies/} → policies</li>
     *   <li>{@code menus/} → menus</li>
     *   <li>{@code collections/} → collections</li>
     *   <li>{@code shop_settings.json} / {@code shop.json} → shop_settings</li>
     *   <li>{@code metafields/} → metafields</li>
     *   <li>{@code files/} → files</li>
     *   <li>其它 → other</li>
     * </ul>
     */
    static String inferCategory(String path) {
        if (path == null) return "other";
        String p = path.startsWith("/") ? path.substring(1) : path;
        int slash = p.indexOf('/');
        String head = slash > 0 ? p.substring(0, slash) : p;
        return switch (head) {
            case "theme", "templates", "sections", "config", "assets", "locales", "snippets" -> "theme";
            case "products" -> "products";
            case "policies" -> "policies";
            case "menus" -> "menus";
            case "collections" -> "collections";
            case "metafields" -> "metafields";
            case "files" -> "files";
            case "shop_settings.json", "shop.json" -> "shop_settings";
            default -> "other";
        };
    }

    /**
     * 调 worker — HTTP/1.1（uvicorn 拒收 h2c upgrade，与 SyncConsumer / PushService 保持一致）。
     */
    private Map<String, Object> callWorker(String path, Map<String, Object> body) throws IOException {
        HttpClient client = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
        String json = objectMapper.writeValueAsString(body);
        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create(workerBaseUrl + path))
            .timeout(Duration.ofSeconds(workerTimeoutSeconds))
            .header("Content-Type", "application/json")
            .version(HttpClient.Version.HTTP_1_1)
            .POST(HttpRequest.BodyPublishers.ofString(json));
        if (workerToken != null && !workerToken.isBlank()) {
            reqBuilder.header("X-Worker-Token", workerToken.trim());
        }
        HttpRequest req = reqBuilder.build();
        HttpResponse<String> resp;
        try {
            resp = client.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IOException("worker call interrupted: " + path, ie);
        }
        if (resp.statusCode() / 100 != 2) {
            throw new IOException("worker " + path + " HTTP " + resp.statusCode() + ": "
                + truncate(resp.body(), 500));
        }
        if (resp.body() == null || resp.body().isEmpty()) return Map.of();
        return objectMapper.readValue(resp.body(), new TypeReference<Map<String, Object>>() {});
    }

    private static String stringOrNull(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static Long asLongOrNull(Object o) {
        if (o == null) return null;
        if (o instanceof Number n) return n.longValue();
        try { return Long.parseLong(String.valueOf(o)); } catch (NumberFormatException e) { return null; }
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    /** Manifest entry 内部投影。包内可见，便于单测验证 parseManifest 结果。 */
    public static class ManifestEntry {
        public String relativePath;
        public String sha256;
        public Long size;
        public String contentType;
    }
}
