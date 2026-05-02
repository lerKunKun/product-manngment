package com.biou.shopifyhub.asset;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * SSE fan-out for asset snapshot progress events (W2-AST-05).
 *
 * <p>Worker (Python) POSTs progress events to {@code /internal/asset/progress}
 * and the controller calls {@link #publish}. We:
 * <ol>
 *   <li>Cache the latest event in Redis under
 *       {@code asset:progress:last:{snapshotId}} with TTL 1h so late
 *       subscribers immediately get the most recent state.</li>
 *   <li>Fan out to every {@link SseEmitter} subscribed to that snapshot.</li>
 * </ol>
 *
 * <p>No history retention beyond the last event — by design.
 */
@Service
public class AssetProgressService {

    private static final Logger log = LoggerFactory.getLogger(AssetProgressService.class);

    private static final String LAST_KEY_PREFIX = "asset:progress:last:";
    private static final long EMITTER_TIMEOUT_MS = 60_000L * 60L; // 1 hour
    private static final Duration LAST_TTL = Duration.ofHours(1);

    private final Map<Long, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public AssetProgressService(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    /**
     * Subscribe a new SSE emitter for the given snapshot. Replays the last
     * cached event immediately if present so a subscriber that connects
     * after the worker has already emitted gets state right away.
     */
    public SseEmitter subscribe(long snapshotId) {
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        emitters.computeIfAbsent(snapshotId, k -> new CopyOnWriteArrayList<>()).add(emitter);
        emitter.onCompletion(() -> remove(snapshotId, emitter));
        emitter.onTimeout(() -> remove(snapshotId, emitter));
        emitter.onError(e -> remove(snapshotId, emitter));

        try {
            String last = redis.opsForValue().get(LAST_KEY_PREFIX + snapshotId);
            if (last != null) {
                emitter.send(SseEmitter.event()
                    .name("snapshot")
                    .data(last, MediaType.APPLICATION_JSON));
            }
        } catch (IOException ignored) {
            // Subscriber disconnected before we could replay; cleanup will fire.
        } catch (Exception e) {
            log.debug("replay last event failed: snapshot={} err={}", snapshotId, e.getMessage());
        }
        return emitter;
    }

    /**
     * Publish a progress event: cache last + fan out to all subscribers.
     */
    public void publish(long snapshotId, Map<String, Object> payload) {
        String json;
        try {
            json = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.warn("publish progress: serialize failed snapshot={} err={}", snapshotId, e.getMessage());
            return;
        }
        try {
            redis.opsForValue().set(LAST_KEY_PREFIX + snapshotId, json, LAST_TTL);
        } catch (Exception e) {
            // Redis hiccup must not block fan-out.
            log.debug("publish progress: redis cache failed snapshot={} err={}", snapshotId, e.getMessage());
        }
        List<SseEmitter> list = emitters.get(snapshotId);
        if (list == null || list.isEmpty()) {
            return;
        }
        for (SseEmitter e : list) {
            try {
                e.send(SseEmitter.event()
                    .name("progress")
                    .data(json, MediaType.APPLICATION_JSON));
            } catch (IOException io) {
                remove(snapshotId, e);
            } catch (Exception ex) {
                log.debug("publish progress: emitter send failed snapshot={} err={}", snapshotId, ex.getMessage());
                remove(snapshotId, e);
            }
        }
    }

    private void remove(long snapshotId, SseEmitter e) {
        List<SseEmitter> list = emitters.get(snapshotId);
        if (list != null) {
            list.remove(e);
            if (list.isEmpty()) {
                emitters.remove(snapshotId);
            }
        }
    }
}
