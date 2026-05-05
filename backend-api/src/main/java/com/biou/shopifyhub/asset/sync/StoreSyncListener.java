package com.biou.shopifyhub.asset.sync;

import com.biou.shopifyhub.asset.AssetSnapshotService;
import com.biou.shopifyhub.core.mq.RabbitMqConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 监听 {@link StoreConnectedEvent}（AS1-02）。
 *
 * <p>事务提交后异步触发 FULL 快照创建 + 投 MQ。链路：
 * <pre>
 *   StoreConnectedEvent (AFTER_COMMIT)
 *     → AssetSnapshotService.createFullStorePending() 落 PENDING 行
 *     → RabbitTemplate.convertAndSend("asset.sync.fullStore", payload)
 *     → SyncConsumer 串行调 worker
 * </pre>
 *
 * <p>异常吞掉 + WARN：监听器永不阻塞调用方（店铺接入主流程）。
 */
@Component
public class StoreSyncListener {

    private static final Logger log = LoggerFactory.getLogger(StoreSyncListener.class);

    private final AssetSnapshotService assetSnapshotService;
    private final RabbitTemplate rabbit;

    public StoreSyncListener(AssetSnapshotService assetSnapshotService, RabbitTemplate rabbit) {
        this.assetSnapshotService = assetSnapshotService;
        this.rabbit = rabbit;
    }

    /**
     * {@code fallbackExecution = true}：OAuth 回调没在 {@code @Transactional} 里直插 store 行，
     * 没事务上下文时也要生效，否则真实 OAuth 接入路径不会触发同步。custom_app 路径在
     * {@code StoreService.connectCustomApp} 上有 {@code @Transactional}，依然走 AFTER_COMMIT。
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onStoreConnected(StoreConnectedEvent event) {
        try {
            handle(event);
        } catch (Exception e) {
            // 不让监听器异常影响业务事务结果
            log.warn("[asset-sync] handle StoreConnectedEvent failed storeId={} err={}",
                event.storeId(), e.getMessage(), e);
        }
    }

    /**
     * 实际处理逻辑——抽出成 public 是为了 controller 的「重新同步」endpoint 直接复用，
     * 不必再发一次 Spring 事件（避免事务边界不清）。
     */
    public long handle(StoreConnectedEvent event) {
        long snapshotId = assetSnapshotService.createFullStorePending(
            event.tenantId(), event.storeId(), event.triggeredBy());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("snapshotId", snapshotId);
        payload.put("storeId", event.storeId());
        payload.put("tenantId", event.tenantId());
        payload.put("triggeredBy", event.triggeredBy());
        payload.put("scheduledAt", (event.connectedAt() == null ? Instant.now() : event.connectedAt()).toString());

        rabbit.convertAndSend(
            RabbitMqConfig.EXCHANGE,
            AssetSyncMqConfig.FULL_STORE_ROUTING_KEY,
            payload);

        log.info("[asset-sync] enqueued fullStore sync snapshotId={} storeId={} tenantId={}",
            snapshotId, event.storeId(), event.tenantId());
        return snapshotId;
    }
}
