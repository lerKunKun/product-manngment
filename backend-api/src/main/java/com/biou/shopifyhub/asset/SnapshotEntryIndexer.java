package com.biou.shopifyhub.asset;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.asset.entity.AssetSnapshot;
import com.biou.shopifyhub.asset.entity.AssetSnapshotEntry;
import com.biou.shopifyhub.asset.mapper.AssetSnapshotEntryMapper;
import com.biou.shopifyhub.asset.mapper.AssetSnapshotMapper;
import com.biou.shopifyhub.file.FileService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 把 R2 manifest.json 里的 entries 平铺索引到 asset_snapshot_entry。
 *
 * <p>策略：懒填充。{@link #ensureIndexed} 第一次被调用时检测 DB 里有没有该 snapshot 的行；
 * 没有就从 R2 拉所有段的 manifest，按 segment 平铺 + 算 category 后 batch insert。
 * 后续调用走快路径（一次 COUNT 查询）。
 *
 * <p>并发安全：多个请求同时第一次访问同一 snapshot 时，下游 COUNT 都看 0，都会进入填充分支；
 * 都会写入相同 entries 形成重复行。后果是 DB 多占点空间 + 列表里同条 entry 出现 N 次。
 * 因为 ingest 本身耗时通常 < 200ms（R2 下载 + JSON 解析），冲突窗口小；要彻底防可加
 * {@code FOR UPDATE} 行锁，但需引入额外的 asset_snapshot 状态字段（snap.entriesIndexed=true）。
 * 当前实现下不强保证；如果用户反馈出现重复行，再加锁。
 */
@Service
public class SnapshotEntryIndexer {

    private static final Logger log = LoggerFactory.getLogger(SnapshotEntryIndexer.class);

    private static final List<String> SEGMENTS = List.of(
        "theme", "product", "shop_settings", "metafields", "files",
        "menu", "policy", "collection"
    );

    private static final Pattern THEME_DIR = Pattern.compile(
        "(^|/)(sections|snippets|templates|config|layout|locales)/");
    private static final Pattern ASSETS_CODE = Pattern.compile(
        "(^|/)assets/.+\\.(css|js|mjs|scss|sass|map)$");
    private static final Pattern IMAGE_EXT = Pattern.compile(
        "\\.(jpe?g|png|gif|webp|svg|ico|bmp|avif|tiff?)$");
    private static final Pattern VIDEO_EXT = Pattern.compile(
        "\\.(mp4|webm|mov|m4v|avi|mkv|ogv)$");
    private static final Pattern FONT_EXT = Pattern.compile(
        "\\.(woff2?|ttf|otf|eot)$");

    private final AssetSnapshotMapper snapshotMapper;
    private final AssetSnapshotEntryMapper entryMapper;
    private final FileService fileService;
    private final ObjectMapper objectMapper;

    public SnapshotEntryIndexer(AssetSnapshotMapper snapshotMapper,
                                AssetSnapshotEntryMapper entryMapper,
                                FileService fileService,
                                ObjectMapper objectMapper) {
        this.snapshotMapper = snapshotMapper;
        this.entryMapper = entryMapper;
        this.fileService = fileService;
        this.objectMapper = objectMapper;
    }

    /**
     * 确保 snapshot 的 entries 已被索引到 asset_snapshot_entry。已索引则直接返回。
     */
    @Transactional
    public void ensureIndexed(Long snapshotId) {
        if (snapshotId == null) return;
        Long existing = entryMapper.selectCount(new LambdaQueryWrapper<AssetSnapshotEntry>()
            .eq(AssetSnapshotEntry::getSnapshotId, snapshotId));
        if (existing != null && existing > 0) return;

        AssetSnapshot snap = snapshotMapper.selectById(snapshotId);
        if (snap == null || snap.getR2Prefix() == null || snap.getR2Prefix().isBlank()) {
            log.debug("snapshot {} has no r2Prefix, skip indexing", snapshotId);
            return;
        }

        String prefix = snap.getR2Prefix();
        if (!prefix.endsWith("/")) prefix = prefix + "/";

        int totalInserted = 0;
        for (String seg : SEGMENTS) {
            String key = prefix + seg + "/manifest.json";
            byte[] data;
            try {
                data = fileService.downloadBytes(key);
            } catch (Exception e) {
                // 该段没成功同步，正常跳过
                log.debug("manifest segment {} missing for snapshot {}: {}", seg, snapshotId, e.getMessage());
                continue;
            }
            if (data == null || data.length == 0) continue;

            List<Map<String, Object>> entries;
            try {
                Map<String, Object> parsed = objectMapper.readValue(
                    data, new TypeReference<Map<String, Object>>() {});
                Object rawEntries = parsed.get("entries");
                if (!(rawEntries instanceof List<?> list)) continue;
                entries = list.stream()
                    .filter(o -> o instanceof Map)
                    .map(o -> (Map<String, Object>) o)
                    .toList();
            } catch (Exception e) {
                log.warn("manifest segment {} parse failed snapshot {}: {}", seg, snapshotId, e.getMessage());
                continue;
            }

            for (Map<String, Object> e : entries) {
                AssetSnapshotEntry row = new AssetSnapshotEntry();
                row.setSnapshotId(snapshotId);
                row.setSegment(seg);
                Object rp = e.get("relative_path");
                if (rp == null) continue;
                String path = rp.toString();
                row.setRelativePath(path);
                Object sha = e.get("sha256");
                if (sha != null) row.setSha256(sha.toString());
                Object sz = e.get("size");
                if (sz instanceof Number num) row.setSize(num.longValue());
                Object ct = e.get("content_type");
                String mime = ct == null ? null : ct.toString();
                row.setContentType(mime);
                row.setCategory(classify(path, mime));
                entryMapper.insert(row);
                totalInserted++;
            }
        }
        log.info("snapshot-entry-index snapshotId={} inserted={}", snapshotId, totalInserted);
    }

    /**
     * 按路径 + MIME 推断 category。规则与前端 classify() 完全一致；改动需同步两边。
     */
    static String classify(String path, String mime) {
        String lower = (path == null ? "" : path).toLowerCase(Locale.ROOT);
        String m = (mime == null ? "" : mime).toLowerCase(Locale.ROOT);

        if (THEME_DIR.matcher(lower).find() || lower.endsWith(".liquid")) return "theme";
        if (ASSETS_CODE.matcher(lower).find()) return "theme";

        if (m.startsWith("image/") || IMAGE_EXT.matcher(lower).find()) return "image";
        if (m.startsWith("video/") || VIDEO_EXT.matcher(lower).find()) return "video";
        if (m.startsWith("font/") || m.contains("font") || FONT_EXT.matcher(lower).find()) return "font";
        if (lower.endsWith(".json")) return "data";
        return "other";
    }
}
