package com.biou.shopifyhub.asset.diff;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.asset.diff.entity.SnapshotDiffCache;
import com.biou.shopifyhub.asset.diff.mapper.SnapshotDiffCacheMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * AS4 收尾：每天 03:30 清理 7 天前的 snapshot_diff_cache 行。
 *
 * <p>diff cache 命中率随时间衰减——同一对 (snapshot_a, snapshot_b, scope) 通常只在
 * 用户看 diff 报告时复用一两次，之后再没人查；且 manifest diff 计算很快（manifest 已在 R2），
 * 缓存目的只是省 worker 一次往返。7 天足够覆盖正常的"出报告 → review"窗口。
 *
 * <p>cron 默认 03:30（避开 02:00 的 password reset cleanup），可由 application.yml 覆盖。
 */
@Component
public class SnapshotDiffCacheCleanupScheduler {

    private static final Logger log = LoggerFactory.getLogger(SnapshotDiffCacheCleanupScheduler.class);

    private final SnapshotDiffCacheMapper mapper;

    public SnapshotDiffCacheCleanupScheduler(SnapshotDiffCacheMapper mapper) {
        this.mapper = mapper;
    }

    @Scheduled(cron = "${asset.diff.cache.cleanup-cron:0 30 3 * * *}")
    public void cleanup() {
        try {
            LocalDateTime cutoff = LocalDateTime.now().minusDays(7);
            int n = mapper.delete(new LambdaQueryWrapper<SnapshotDiffCache>()
                .lt(SnapshotDiffCache::getComputedAt, cutoff));
            if (n > 0) {
                log.info("[diff-cache-cleanup] purged {} stale diff cache rows (cutoff={})", n, cutoff);
            }
        } catch (Exception e) {
            log.error("[diff-cache-cleanup] failed: {}", e.getMessage(), e);
        }
    }
}
