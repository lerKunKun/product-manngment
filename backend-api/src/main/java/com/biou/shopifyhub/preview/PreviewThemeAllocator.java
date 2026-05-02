package com.biou.shopifyhub.preview;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.preview.entity.PreviewTheme;
import com.biou.shopifyhub.preview.mapper.PreviewThemeMapper;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * W3-PV-03：把一个 partner-collab dev store 分配给某产品预览。
 *
 * 选店策略：tenant 内 partner-collab + ACTIVE 的 dev store，挑当前活跃 preview_theme 行数最少的；
 * 若所有候选都已达 {@code preview.max-per-dev-store}（默认 3），返回 null（调用方抛 IllegalStateException）。
 */
@Service
public class PreviewThemeAllocator {
    private static final Logger log = LoggerFactory.getLogger(PreviewThemeAllocator.class);

    private final StoreMapper storeMapper;
    private final PreviewThemeMapper previewMapper;

    @Value("${preview.max-per-dev-store:3}")
    private int maxPerDevStore;

    @Value("${preview.ttl-hours:24}")
    private int ttlHours;

    public PreviewThemeAllocator(StoreMapper storeMapper, PreviewThemeMapper previewMapper) {
        this.storeMapper = storeMapper;
        this.previewMapper = previewMapper;
    }

    /**
     * Pick a partner-collab + ACTIVE dev store in this tenant with the lowest current
     * active (PENDING/BUILDING/READY) preview_theme count, subject to the max-per-dev-store cap.
     *
     * @return chosen store id, or null if no eligible store / all at capacity.
     */
    public Long pickLeastLoadedDevStore(Long tenantId) {
        List<Store> candidates = storeMapper.selectList(
            new LambdaQueryWrapper<Store>()
                .eq(Store::getIsPartnerCollab, true)
                .eq(Store::getStatus, "ACTIVE")
                .eq(Store::getTenantId, tenantId)
        );
        if (candidates.isEmpty()) {
            log.warn("[preview] no partner-collab dev stores for tenantId={}", tenantId);
            return null;
        }
        Long bestStoreId = null;
        int bestCount = Integer.MAX_VALUE;
        for (Store s : candidates) {
            long count = previewMapper.selectCount(
                new LambdaQueryWrapper<PreviewTheme>()
                    .eq(PreviewTheme::getDevStoreId, s.getId())
                    .in(PreviewTheme::getStatus, List.of("PENDING", "BUILDING", "READY"))
            );
            if (count < maxPerDevStore && count < bestCount) {
                bestCount = (int) count;
                bestStoreId = s.getId();
            }
        }
        if (bestStoreId == null) {
            log.warn("[preview] all dev stores at capacity (max={}) tenantId={}", maxPerDevStore, tenantId);
        }
        return bestStoreId;
    }

    /**
     * Create a new preview_theme row with status=PENDING + expires_at = now + ttl.
     * Caller (controller) then triggers worker /preview/build (W3-PV-04) async.
     */
    public PreviewTheme allocate(Long tenantId, Long sourceProductId) {
        Long devStoreId = pickLeastLoadedDevStore(tenantId);
        if (devStoreId == null) {
            throw new IllegalStateException("no available partner-collab dev store");
        }
        PreviewTheme p = new PreviewTheme();
        p.setTenantId(tenantId);
        p.setSourceProductId(sourceProductId);
        p.setDevStoreId(devStoreId);
        p.setStatus("PENDING");
        p.setExpiresAt(LocalDateTime.now().plusHours(ttlHours));
        previewMapper.insert(p);
        log.info("[preview] allocated id={} devStoreId={} productId={}", p.getId(), devStoreId, sourceProductId);
        return p;
    }

    /** Mark accessed (user clicked the preview link). No-op if id unknown / soft-deleted. */
    public void markAccessed(Long previewId) {
        PreviewTheme p = previewMapper.selectById(previewId);
        if (p == null) return;
        p.setLastAccessedAt(LocalDateTime.now());
        previewMapper.updateById(p);
    }
}
