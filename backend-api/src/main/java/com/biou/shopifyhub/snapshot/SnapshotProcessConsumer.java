package com.biou.shopifyhub.snapshot;

import com.biou.shopifyhub.core.mq.RabbitMqConfig;
import com.biou.shopifyhub.snapshot.entity.ProductSnapshot;
import com.biou.shopifyhub.snapshot.mapper.ProductSnapshotMapper;
import com.rabbitmq.client.Channel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Consumer for snapshot process queue (W2-SNAP-04: real generation).
 *
 * <p>Receives messages dead-lettered from {@code snap.delay} after the debounce TTL elapses.
 * Flips status PENDING → RUNNING, then delegates to {@link SnapshotGenerationService} which
 * calls the worker, downloads {@code product.json} from R2, serializes a CSV, uploads it,
 * and marks the row SUCCESS or FAILED.
 *
 * <p>Ack policy: manual ack ({@code spring.rabbitmq.listener.simple.acknowledge-mode=manual}
 * is the platform default). We always ack on the first attempt — at-most-once. The generation
 * service catches all exceptions internally and persists them as FAILED rows, so the consumer
 * never requeues. This avoids requeue storms when the worker is unreachable.
 */
@Component
public class SnapshotProcessConsumer {

    private static final Logger log = LoggerFactory.getLogger(SnapshotProcessConsumer.class);

    private final ProductSnapshotMapper snapshotMapper;
    private final SnapshotGenerationService generationService;

    public SnapshotProcessConsumer(ProductSnapshotMapper snapshotMapper,
                                   SnapshotGenerationService generationService) {
        this.snapshotMapper = snapshotMapper;
        this.generationService = generationService;
    }

    @RabbitListener(queues = RabbitMqConfig.SNAPSHOT_PROCESS_QUEUE)
    public void onMessage(@Payload Map<String, Object> payload,
                          Channel channel,
                          @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag) {
        try {
            Object snapIdObj = payload.get("snapshotId");
            if (!(snapIdObj instanceof Number)) {
                log.warn("snapshot consumer: missing/invalid snapshotId in payload={}", payload);
                return;
            }
            long snapshotId = ((Number) snapIdObj).longValue();

            ProductSnapshot snap = snapshotMapper.selectById(snapshotId);
            if (snap == null) {
                log.warn("snapshot not found: id={}", snapshotId);
                return;
            }
            if (!"PENDING".equals(snap.getStatus())) {
                log.info("snapshot not PENDING (status={}) skipping: id={}", snap.getStatus(), snapshotId);
                return;
            }

            snap.setStatus("RUNNING");
            snap.setStartedAt(LocalDateTime.now());
            snapshotMapper.updateById(snap);
            log.info("snapshot RUNNING (W2-SNAP-04 generating): id={} store={} product={}",
                snapshotId, snap.getStoreId(), snap.getProductExternalId());

            // Delegate to generation service. It catches its own exceptions and writes
            // FAILED + error_message to the row. Never throws back here.
            generationService.generate(snapshotId);
        } catch (Exception e) {
            log.error("snapshot consumer error: payload={} err={}", payload, e.getMessage(), e);
            // do not rethrow — at-most-once
        } finally {
            try {
                channel.basicAck(deliveryTag, false);
            } catch (Exception ackErr) {
                log.warn("snapshot consumer ack failed tag={} err={}", deliveryTag, ackErr.getMessage());
            }
        }
    }
}
