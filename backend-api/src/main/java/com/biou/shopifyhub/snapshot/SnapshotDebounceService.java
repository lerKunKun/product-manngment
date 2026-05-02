package com.biou.shopifyhub.snapshot;

import com.biou.shopifyhub.core.mq.RabbitMqConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Redis-NX-based debounce + RabbitMQ TTL/DLX delayed publish (W2-SNAP-03).
 *
 * <p>Multiple Shopify {@code products/update} webhooks for the same {@code (storeId, productExternalId)}
 * within {@code shopify.snapshot.debounce-seconds} window collapse to ONE downstream snapshot job.
 *
 * <p>Architecture:
 * <ol>
 *   <li>{@link StringRedisTemplate#opsForValue()} {@code SET NX} guards uniqueness.
 *   <li>If lock acquired → publish JSON to {@code shub.snapshot.delay} → TTL queue → DLX → consumer.
 *   <li>If lock held → log only, no MQ traffic.
 *   <li>If MQ publish fails → release Redis key so the next webhook can retry.
 * </ol>
 *
 * <p>Failure modes (all "no-op safe"):
 * <ul>
 *   <li>Redis down → SET NX throws → caller should still 200 (caught by controller).
 *   <li>RabbitMQ down → publish throws → key released, false returned, caller still 200.
 * </ul>
 */
@Service
public class SnapshotDebounceService {

    private static final Logger log = LoggerFactory.getLogger(SnapshotDebounceService.class);

    private final StringRedisTemplate redis;
    private final RabbitTemplate rabbit;

    @Value("${shopify.snapshot.debounce-seconds:300}")
    private long debounceSeconds;

    public SnapshotDebounceService(StringRedisTemplate redis, RabbitTemplate rabbit) {
        this.redis = redis;
        this.rabbit = rabbit;
    }

    /**
     * Try to acquire the debounce lock and enqueue a delayed snapshot job.
     *
     * @return {@code true} if this call won the race (lock + publish OK);
     *         {@code false} if duplicate within window OR publish failed (no-op safe).
     */
    public boolean tryEnqueue(long snapshotId, long tenantId, long storeId, String productExternalId) {
        String key = "snap:debounce:" + storeId + ":" + productExternalId;
        Boolean acquired;
        try {
            acquired = redis.opsForValue()
                .setIfAbsent(key, String.valueOf(snapshotId), Duration.ofSeconds(debounceSeconds));
        } catch (Exception e) {
            log.warn("snapshot debounce: redis SET NX failed key={} err={}", key, e.getMessage());
            return false;
        }

        if (!Boolean.TRUE.equals(acquired)) {
            String leader;
            try {
                leader = redis.opsForValue().get(key);
            } catch (Exception e) {
                leader = "<redis-read-failed>";
            }
            log.info("snapshot debounced: store={} product={} new={} leader={}",
                storeId, productExternalId, snapshotId, leader);
            return false;
        }

        try {
            // Use LinkedHashMap to preserve key order in JSON (cosmetic; aids log readability).
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("snapshotId", snapshotId);
            payload.put("tenantId", tenantId);
            payload.put("storeId", storeId);
            payload.put("productExternalId", productExternalId);
            payload.put("scheduledAt", Instant.now().toString());

            rabbit.convertAndSend(
                RabbitMqConfig.SNAPSHOT_DELAY_EXCHANGE,
                RabbitMqConfig.SNAPSHOT_PROCESS_ROUTING_KEY,
                payload);

            log.info("snapshot enqueued: id={} store={} product={} delayMs={}",
                snapshotId, storeId, productExternalId, debounceSeconds * 1000L);
            return true;
        } catch (RuntimeException e) {
            // Release lock so next webhook can retry. Don't blow up — caller still returns 200.
            try {
                redis.delete(key);
            } catch (Exception ignored) {
                // best effort
            }
            log.warn("snapshot enqueue failed: id={} store={} product={} err={} (key released)",
                snapshotId, storeId, productExternalId, e.getMessage());
            return false;
        }
    }
}
