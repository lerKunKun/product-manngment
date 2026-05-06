package com.biou.shopifyhub.asset.diff;

import com.biou.shopifyhub.asset.diff.dto.DiffChange;
import com.biou.shopifyhub.asset.diff.dto.ManifestDiffResult;
import com.biou.shopifyhub.asset.diff.entity.SnapshotDiffCache;
import com.biou.shopifyhub.asset.diff.mapper.SnapshotDiffCacheMapper;
import com.biou.shopifyhub.asset.entity.AssetSnapshot;
import com.biou.shopifyhub.asset.mapper.AssetSnapshotMapper;
import com.biou.shopifyhub.file.FileService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;

/**
 * AS4：DiffService 单元测试。manifest 层不依赖 worker，本测试 mock {@link FileService}
 * 直接喂两份 manifest JSON 字节，验证 added/removed/modified/unchanged 输出。
 */
class DiffServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private DiffService newService(byte[] manifestA, byte[] manifestB,
                                   AssetSnapshotMapper snapMapper,
                                   SnapshotDiffCacheMapper cacheMapper) throws Exception {
        FileService fs = mock(FileService.class);
        // First call returns A's bytes, second returns B's. Order = A then B.
        when(fs.downloadBytes(any(String.class)))
            .thenReturn(manifestA)
            .thenReturn(manifestB);
        return new DiffService(cacheMapper, snapMapper, fs, mapper);
    }

    private static AssetSnapshot snap(long id, String prefix) {
        AssetSnapshot s = new AssetSnapshot();
        s.setId(id);
        s.setTenantId(1L);
        s.setStoreId(10L);
        s.setSnapshotType("FULL");
        s.setStatus("SUCCESS");
        s.setR2Prefix(prefix);
        return s;
    }

    @Test
    void manifest_diff_classifies_added_removed_modified_unchanged() throws Exception {
        // A has: templates/index.json (sha=A1), assets/foo.css (sha=A2), products/100.json (sha=A3)
        // B has: templates/index.json (sha=B1, MODIFIED), assets/foo.css (sha=A2, UNCHANGED), products/200.json (sha=B3, ADDED)
        // → ADDED products/200.json; REMOVED products/100.json; MODIFIED templates/index.json; UNCHANGED assets/foo.css
        String manifestAJson = """
            {"version":1,"generated_at":"t","entries":[
              {"relative_path":"templates/index.json","sha256":"a1","size":10,"content_type":"application/json"},
              {"relative_path":"assets/foo.css","sha256":"a2","size":20,"content_type":"text/css"},
              {"relative_path":"products/100.json","sha256":"a3","size":30,"content_type":"application/json"}
            ]}
            """;
        String manifestBJson = """
            {"version":1,"generated_at":"t","entries":[
              {"relative_path":"templates/index.json","sha256":"b1","size":11,"content_type":"application/json"},
              {"relative_path":"assets/foo.css","sha256":"a2","size":20,"content_type":"text/css"},
              {"relative_path":"products/200.json","sha256":"b3","size":33,"content_type":"application/json"}
            ]}
            """;
        AssetSnapshotMapper snapMapper = mock(AssetSnapshotMapper.class);
        when(snapMapper.selectById(1L)).thenReturn(snap(1L, "tenants/1/stores/10/snapshots/1/"));
        when(snapMapper.selectById(2L)).thenReturn(snap(2L, "tenants/1/stores/10/snapshots/2/"));
        SnapshotDiffCacheMapper cacheMapper = mock(SnapshotDiffCacheMapper.class);
        DiffService svc = newService(
            manifestAJson.getBytes(),
            manifestBJson.getBytes(),
            snapMapper, cacheMapper);

        ManifestDiffResult result = svc.computeManifestDiff(1L, 2L);

        assertNotNull(result.summary);
        assertEquals(1, result.summary.added);
        assertEquals(1, result.summary.removed);
        assertEquals(1, result.summary.modified);
        assertEquals(1, result.summary.unchanged);
        assertEquals(3, result.changes.size(), "UNCHANGED should be filtered out");

        // verify path-level outcomes
        DiffChange added = findByPath(result.changes, "products/200.json");
        assertEquals("ADDED", added.kind);
        assertEquals("products", added.category);
        assertEquals("b3", added.shaB);
        assertNull(added.shaA);

        DiffChange removed = findByPath(result.changes, "products/100.json");
        assertEquals("REMOVED", removed.kind);
        assertEquals("products", removed.category);
        assertEquals("a3", removed.shaA);
        assertNull(removed.shaB);

        DiffChange modified = findByPath(result.changes, "templates/index.json");
        assertEquals("MODIFIED", modified.kind);
        assertEquals("theme", modified.category);
        assertEquals("a1", modified.shaA);
        assertEquals("b1", modified.shaB);
    }

    @Test
    void manifest_diff_two_identical_manifests_yields_only_unchanged() throws Exception {
        String json = """
            {"version":1,"generated_at":"t","entries":[
              {"relative_path":"templates/index.json","sha256":"x","size":1,"content_type":"application/json"}
            ]}
            """;
        AssetSnapshotMapper snapMapper = mock(AssetSnapshotMapper.class);
        when(snapMapper.selectById(1L)).thenReturn(snap(1L, "tenants/1/stores/10/snapshots/1/"));
        when(snapMapper.selectById(2L)).thenReturn(snap(2L, "tenants/1/stores/10/snapshots/2/"));
        DiffService svc = newService(json.getBytes(), json.getBytes(),
            snapMapper, mock(SnapshotDiffCacheMapper.class));

        ManifestDiffResult result = svc.computeManifestDiff(1L, 2L);
        assertEquals(0, result.summary.added);
        assertEquals(0, result.summary.removed);
        assertEquals(0, result.summary.modified);
        assertEquals(1, result.summary.unchanged);
        assertTrue(result.changes.isEmpty(), "no deltas → no changes returned");
    }

    @Test
    void getOrCompute_returns_cached_when_hit() throws Exception {
        // simulate prior cache row with a known shape
        ManifestDiffResult prior = new ManifestDiffResult();
        prior.summary = new com.biou.shopifyhub.asset.diff.dto.DiffSummary(1L, 2L);
        prior.summary.added = 7;
        prior.changes = new ArrayList<>();
        String priorJson = mapper.writeValueAsString(prior);
        SnapshotDiffCache cached = new SnapshotDiffCache();
        cached.setId(99L);
        cached.setSnapshotAId(1L);
        cached.setSnapshotBId(2L);
        cached.setScope(DiffService.SCOPE_MANIFEST);
        cached.setResultJson(priorJson);

        SnapshotDiffCacheMapper cacheMapper = mock(SnapshotDiffCacheMapper.class);
        when(cacheMapper.selectOne(any())).thenReturn(cached);

        AssetSnapshotMapper snapMapper = mock(AssetSnapshotMapper.class);
        FileService fs = mock(FileService.class);
        DiffService svc = new DiffService(cacheMapper, snapMapper, fs, mapper);

        ManifestDiffResult result = svc.getOrComputeManifestDiff(1L, 2L);
        assertTrue(result.cached);
        assertEquals(7, result.summary.added);
        // shouldn't have hit downloadBytes — cache short-circuited
        verify(fs, never()).downloadBytes(any());
    }

    @Test
    void parse_manifest_skips_entries_with_blank_path() {
        SnapshotDiffCacheMapper cacheMapper = mock(SnapshotDiffCacheMapper.class);
        DiffService svc = new DiffService(cacheMapper, mock(AssetSnapshotMapper.class),
            mock(FileService.class), mapper);
        String json = """
            {"version":1,"entries":[
              {"relative_path":"","sha256":"x","size":1},
              {"relative_path":"templates/index.json","sha256":"y","size":2}
            ]}
            """;
        Map<String, DiffService.ManifestEntry> entries = svc.parseManifest(json.getBytes());
        assertEquals(1, entries.size());
        assertTrue(entries.containsKey("templates/index.json"));
    }

    @Test
    void infer_category_known_prefixes() {
        assertEquals("theme", DiffService.inferCategory("templates/index.json"));
        assertEquals("theme", DiffService.inferCategory("assets/foo.css"));
        assertEquals("theme", DiffService.inferCategory("config/settings_data.json"));
        assertEquals("products", DiffService.inferCategory("products/123.json"));
        assertEquals("policies", DiffService.inferCategory("policies/refund.json"));
        assertEquals("menus", DiffService.inferCategory("menus/main-menu.json"));
        assertEquals("collections", DiffService.inferCategory("collections/all.json"));
        assertEquals("metafields", DiffService.inferCategory("metafields/store.json"));
        assertEquals("files", DiffService.inferCategory("files/banner.png"));
        assertEquals("shop_settings", DiffService.inferCategory("shop_settings.json"));
        assertEquals("other", DiffService.inferCategory("unknown.txt"));
        assertEquals("other", DiffService.inferCategory(null));
    }

    private static DiffChange findByPath(List<DiffChange> all, String path) {
        return all.stream().filter(c -> path.equals(c.path)).findFirst().orElseThrow();
    }
}
