package com.biou.shopifyhub.preview;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.preview.entity.PreviewTheme;
import com.biou.shopifyhub.preview.mapper.PreviewThemeMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * W3-PV-06：preview_theme 兜底清理。
 *
 * 每 30 分钟扫一次：
 * (a) expires_at &lt; now 且仍处 PENDING/BUILDING/READY → 切 EXPIRED + 软删；
 * (b) 同一 dev store 活跃数超过 {@code preview.max-per-dev-store} → 删最老的几条。
 */
@Component
public class PreviewThemeCleanupScheduler {
    private static final Logger log = LoggerFactory.getLogger(PreviewThemeCleanupScheduler.class);

    private final PreviewThemeMapper previewMapper;

    @Value("${preview.max-per-dev-store:3}")
    private int maxPerDevStore;

    public PreviewThemeCleanupScheduler(PreviewThemeMapper previewMapper) {
        this.previewMapper = previewMapper;
    }

    @Scheduled(cron = "${preview.cleanup-cron:0 */30 * * * *}")
    public void cleanup() {
        try {
            int expired = expireOverdue();
            int overQuota = enforceQuota();
            log.info("[preview-cleanup] done expired={} overQuota={}", expired, overQuota);
        } catch (Exception e) {
            log.error("[preview-cleanup] failed: {}", e.getMessage(), e);
        }
    }

    /** Hard expiry: expires_at &lt; now AND status not in terminal. */
    int expireOverdue() {
        List<PreviewTheme> due = previewMapper.selectList(
            new LambdaQueryWrapper<PreviewTheme>()
                .lt(PreviewTheme::getExpiresAt, LocalDateTime.now())
                .in(PreviewTheme::getStatus, List.of("PENDING", "BUILDING", "READY"))
        );
        int n = 0;
        for (PreviewTheme p : due) {
            p.setStatus("EXPIRED");
            p.setDeletedAt(LocalDateTime.now()); // soft delete via @TableLogic
            previewMapper.updateById(p);
            n++;
        }
        return n;
    }

    /** Per-dev-store quota: if active count exceeds max, soft-delete oldest. */
    int enforceQuota() {
        List<PreviewTheme> all = previewMapper.selectList(
            new LambdaQueryWrapper<PreviewTheme>()
                .in(PreviewTheme::getStatus, List.of("PENDING", "BUILDING", "READY"))
                .orderByAsc(PreviewTheme::getCreatedAt) // oldest first
        );
        Map<Long, List<PreviewTheme>> byStore = all.stream()
            .collect(Collectors.groupingBy(PreviewTheme::getDevStoreId));
        int n = 0;
        for (Map.Entry<Long, List<PreviewTheme>> e : byStore.entrySet()) {
            List<PreviewTheme> rows = e.getValue();
            if (rows.size() <= maxPerDevStore) continue;
            int toExpire = rows.size() - maxPerDevStore;
            for (int i = 0; i < toExpire; i++) {
                PreviewTheme p = rows.get(i);
                p.setStatus("EXPIRED");
                p.setDeletedAt(LocalDateTime.now());
                previewMapper.updateById(p);
                n++;
                log.info("[preview-cleanup] over-quota expire id={} devStoreId={}", p.getId(), e.getKey());
            }
        }
        return n;
    }
}
