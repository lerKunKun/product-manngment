package com.biou.shopifyhub.asset;

import com.biou.shopifyhub.asset.entity.AssetSnapshot;
import com.biou.shopifyhub.asset.mapper.AssetSnapshotMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 资产快照写入侧 service（AS1-02）。
 *
 * <p>当前只暴露 {@link #createFullStorePending(long, long, Long)} 一个方法，
 * 给 asset.sync 监听器/重新同步 endpoint 复用。其他读路径仍由
 * {@link AssetSnapshotController} 直接走 mapper（保持现有 endpoint 不动）。
 */
@Service
public class AssetSnapshotService {

    private static final Logger log = LoggerFactory.getLogger(AssetSnapshotService.class);

    private final AssetSnapshotMapper snapshotMapper;

    public AssetSnapshotService(AssetSnapshotMapper snapshotMapper) {
        this.snapshotMapper = snapshotMapper;
    }

    /**
     * 创建一行 FULL+PENDING 的 asset_snapshot 并返回 id。
     *
     * <p>r2_prefix 按全仓约定（worker 各 *_pull.py 同款）：
     * {@code tenants/{tid}/stores/{sid}/snapshots/{snapId}/}。
     * 由于 r2_prefix 是 NOT NULL 列，需要在 insert 前用 placeholder 占位再
     * 拿到自增 id 后回填——MyBatis-Plus insert 会回写 id，因此先写一个临时
     * 前缀（不含 snapshotId）走 insert，再 update。
     */
    @Transactional
    public long createFullStorePending(long tenantId, long storeId, Long triggeredBy) {
        AssetSnapshot snap = new AssetSnapshot();
        snap.setTenantId(tenantId);
        snap.setStoreId(storeId);
        snap.setSnapshotType("FULL");
        snap.setStatus("PENDING");
        snap.setTriggeredBy(triggeredBy);
        // r2_prefix 是 NOT NULL 列，先放占位，拿到 id 再回填带 snapshotId 的最终前缀。
        snap.setR2Prefix(buildR2Prefix(tenantId, storeId, 0L));
        snap.setFileCount(0);
        snap.setTotalBytes(0L);
        snapshotMapper.insert(snap);

        Long snapshotId = snap.getId();
        snap.setR2Prefix(buildR2Prefix(tenantId, storeId, snapshotId));
        snapshotMapper.updateById(snap);

        log.info("[asset-sync] createFullStorePending tenantId={} storeId={} snapshotId={} triggeredBy={}",
            tenantId, storeId, snapshotId, triggeredBy);
        return snapshotId;
    }

    public static String buildR2Prefix(long tenantId, long storeId, long snapshotId) {
        return "tenants/" + tenantId + "/stores/" + storeId + "/snapshots/" + snapshotId + "/";
    }
}
