package com.biou.shopifyhub.asset;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

/**
 * Public SSE stream + internal worker callback for snapshot progress (W2-AST-05).
 *
 * <ul>
 *   <li>{@code GET /asset/snapshot/{id}/events} — frontend EventSource long-poll;
 *       open to anonymous (gated by SecurityConfig allow-list).</li>
 *   <li>{@code POST /internal/asset/progress} — worker callback. Authenticated
 *       via shared secret header {@code X-Internal-Token} matched against
 *       {@code app.internal.token}. Empty/absent config disables the callback
 *       and returns 503 instead of accepting anonymous calls.</li>
 * </ul>
 */
@RestController
public class AssetProgressController {

    private static final Logger log = LoggerFactory.getLogger(AssetProgressController.class);

    private final AssetProgressService service;

    @Value("${app.internal.token:}")
    private String internalToken;

    public AssetProgressController(AssetProgressService service) {
        this.service = service;
    }

    @PostConstruct
    void warnIfTokenMissing() {
        if (internalToken == null || internalToken.isBlank()) {
            log.error("app.internal.token is empty; /internal/asset/progress will reject callbacks with 503.");
        }
    }

    @GetMapping(path = "/asset/snapshot/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable("id") long snapshotId) {
        return service.subscribe(snapshotId);
    }

    @PostMapping("/internal/asset/progress")
    public ResponseEntity<Void> progress(
        @RequestHeader(value = "X-Internal-Token", required = false) String token,
        @RequestBody Map<String, Object> payload
    ) {
        String expectedToken = internalToken == null ? "" : internalToken.trim();
        if (expectedToken.isEmpty()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        if (!expectedToken.equals(token)) {
            return ResponseEntity.status(401).build();
        }
        Object sidObj = payload.get("snapshotId");
        if (!(sidObj instanceof Number sid)) {
            return ResponseEntity.badRequest().build();
        }
        service.publish(sid.longValue(), payload);
        return ResponseEntity.ok().build();
    }
}
