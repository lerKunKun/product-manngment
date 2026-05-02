package com.biou.shopifyhub.newstore;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * W3-NEW-09: SSE fan-out for saga progress events.
 *
 * <p>Mirrors the W2-AST-05 pattern ({@code AssetProgressService}):
 * <ol>
 *   <li>Per-saga {@link SseEmitter} list keyed by {@code sagaTaskId}.</li>
 *   <li>Last event cached in Redis under {@code saga:progress:last:{taskId}}
 *       with TTL 1h so a late subscriber immediately gets the most recent
 *       state on connect.</li>
 *   <li>{@link #publish} is non-blocking — Redis hiccups / serialization
 *       errors / send failures are swallowed (debug/warn) so a dead emitter
 *       never blocks {@link SagaService} state transitions.</li>
 * </ol>
 *
 * <p>By design the publish path tolerates "no subscribers" — that's the
 * normal case during automated saga runs.
 */
@Service
public class SagaProgressService {

    private static final Logger log = LoggerFactory.getLogger(SagaProgressService.class);

    private static final String LAST_KEY_PREFIX = "saga:progress:last:";
    private static final long EMITTER_TIMEOUT_MS = 60_000L * 60L; // 1 hour
    private static final Duration LAST_TTL = Duration.ofHours(1);

    private final Map<Long, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public SagaProgressService(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    /**
     * Subscribe a new SSE emitter for the given saga task. Replays the last
     * cached event immediately if present.
     */
    public SseEmitter subscribe(long sagaTaskId) {
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        emitters.computeIfAbsent(sagaTaskId, k -> new CopyOnWriteArrayList<>()).add(emitter);
        emitter.onCompletion(() -> remove(sagaTaskId, emitter));
        emitter.onTimeout(() -> remove(sagaTaskId, emitter));
        emitter.onError(e -> remove(sagaTaskId, emitter));

        try {
            String last = redis.opsForValue().get(LAST_KEY_PREFIX + sagaTaskId);
            if (last != null) {
                emitter.send(SseEmitter.event()
                    .name("saga")
                    .data(last, MediaType.APPLICATION_JSON));
            }
        } catch (IOException ignored) {
            // Subscriber disconnected before replay; cleanup will fire.
        } catch (Exception e) {
            log.debug("[saga-progress] replay last event failed: sagaId={} err={}", sagaTaskId, e.getMessage());
        }
        return emitter;
    }

    /**
     * Publish a progress event: cache last + fan out to all subscribers.
     * Always non-blocking; errors are swallowed.
     */
    public void publish(long sagaTaskId, String eventType, String step, String status, Map<String, Object> extra) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("sagaTaskId", sagaTaskId);
        payload.put("event", eventType);
        payload.put("step", step);
        payload.put("status", status);
        payload.put("ts", Instant.now().toString());
        if (extra != null) payload.putAll(extra);

        String json;
        try {
            json = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.warn("[saga-progress] publish: serialize failed sagaId={} err={}", sagaTaskId, e.getMessage());
            return;
        }
        try {
            redis.opsForValue().set(LAST_KEY_PREFIX + sagaTaskId, json, LAST_TTL);
        } catch (Exception e) {
            log.debug("[saga-progress] redis cache failed sagaId={} err={}", sagaTaskId, e.getMessage());
        }
        List<SseEmitter> list = emitters.get(sagaTaskId);
        if (list == null || list.isEmpty()) {
            return;
        }
        for (SseEmitter e : list) {
            try {
                e.send(SseEmitter.event()
                    .name("progress")
                    .data(json, MediaType.APPLICATION_JSON));
            } catch (IOException io) {
                remove(sagaTaskId, e);
            } catch (Exception ex) {
                log.debug("[saga-progress] emitter send failed sagaId={} err={}", sagaTaskId, ex.getMessage());
                remove(sagaTaskId, e);
            }
        }
    }

    private void remove(long sagaTaskId, SseEmitter e) {
        List<SseEmitter> list = emitters.get(sagaTaskId);
        if (list != null) {
            list.remove(e);
            if (list.isEmpty()) {
                emitters.remove(sagaTaskId);
            }
        }
    }
}
