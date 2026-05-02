package com.biou.shopifyhub.store;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import com.biou.shopifyhub.store.entity.Store;
import com.biou.shopifyhub.store.mapper.StoreMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * W1-STORE-03 Token 过期检查：
 *   - 每天 06:00 扫所有 store，expires_at 7 天内 → 发 TOKEN_EXPIRING 通知
 *   - expires_at 已过 → 切 status=TOKEN_EXPIRED
 *
 * Wave 1 简化：通知发给 invitedBy（如有），后续完整化按店铺所有人发。
 */
@Component
public class StoreTokenScheduler {

    private static final Logger log = LoggerFactory.getLogger(StoreTokenScheduler.class);

    private final StoreMapper storeMapper;
    private final NotificationDispatcher notifier;
    private final AtomicInteger expiringSoonGauge = new AtomicInteger(0);

    public StoreTokenScheduler(StoreMapper storeMapper, NotificationDispatcher notifier,
                               MeterRegistry meterRegistry) {
        this.storeMapper = storeMapper;
        this.notifier = notifier;
        meterRegistry.gauge("shopifyhub.store.tokens.expiring_soon", expiringSoonGauge);
    }

    @Scheduled(cron = "${store.token-check-cron:0 0 6 * * *}")
    public void check() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime in7d = now.plusDays(7);

        // 已过期
        List<Store> expired = storeMapper.selectList(new QueryWrapper<Store>()
            .eq("status", "ACTIVE")
            .isNotNull("expires_at")
            .le("expires_at", now));
        for (Store s : expired) {
            s.setStatus("TOKEN_EXPIRED");
            storeMapper.updateById(s);
            log.warn("[store-token] expired domain={}", s.getMyshopifyDomain());
        }

        // 7 天内即将过期（且还在 ACTIVE）
        List<Store> soon = storeMapper.selectList(new QueryWrapper<Store>()
            .eq("status", "ACTIVE")
            .isNotNull("expires_at")
            .gt("expires_at", now)
            .le("expires_at", in7d));
        expiringSoonGauge.set(soon.size());
        for (Store s : soon) {
            // Wave 1：店铺没有 owner 字段，先简单广播给 admin（id=1）
            notifier.notifyUser(
                1L,
                NotificationEventCode.TOKEN_EXPIRING,
                "店铺 Token 即将过期",
                String.format("店铺 %s 的 access_token 将在 %s 过期，请及时续期。",
                    s.getMyshopifyDomain(), s.getExpiresAt()),
                null
            );
        }
        if (!expired.isEmpty() || !soon.isEmpty()) {
            log.info("[store-token] expired={} soon={}", expired.size(), soon.size());
        }
    }
}
