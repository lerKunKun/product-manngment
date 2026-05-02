package com.biou.shopifyhub.newstore;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * W3-NEW-09: Public SSE stream for saga progress events.
 *
 * <p>{@code GET /saga/{id}/events} — frontend EventSource long-poll;
 * open to anonymous (gated by SecurityConfig allow-list) so the browser
 * does not need to attach a JWT (EventSource cannot easily set auth
 * headers).
 */
@RestController
public class SagaProgressController {

    private final SagaProgressService service;

    public SagaProgressController(SagaProgressService service) {
        this.service = service;
    }

    @GetMapping(path = "/saga/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable("id") long sagaTaskId) {
        return service.subscribe(sagaTaskId);
    }
}
