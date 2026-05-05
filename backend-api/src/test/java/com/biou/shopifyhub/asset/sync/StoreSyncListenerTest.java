package com.biou.shopifyhub.asset.sync;

import com.biou.shopifyhub.asset.AssetSnapshotService;
import com.biou.shopifyhub.core.mq.RabbitMqConfig;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * AS1-02：StoreSyncListener 单元测试。
 *
 * <p>不起 Spring 上下文——纯 Mockito，验证：
 * 收到 {@link StoreConnectedEvent} 后调用了 {@link AssetSnapshotService#createFullStorePending}
 * 并通过 {@link RabbitTemplate#convertAndSend(String, String, Object)} 发了 MQ 消息。
 */
class StoreSyncListenerTest {

    @Test
    void onStoreConnected_creates_pending_snapshot_and_publishes_mq() {
        AssetSnapshotService service = mock(AssetSnapshotService.class);
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        when(service.createFullStorePending(eq(7L), eq(42L), eq(99L))).thenReturn(123L);

        StoreSyncListener listener = new StoreSyncListener(service, rabbit);

        Instant now = Instant.parse("2026-05-05T10:00:00Z");
        listener.onStoreConnected(new StoreConnectedEvent(42L, 7L, 99L, now));

        verify(service, times(1)).createFullStorePending(7L, 42L, 99L);

        ArgumentCaptor<String> exchangeCap = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> routingCap = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object> bodyCap = ArgumentCaptor.forClass(Object.class);
        verify(rabbit, times(1))
            .convertAndSend(exchangeCap.capture(), routingCap.capture(), bodyCap.capture());

        assertEquals(RabbitMqConfig.EXCHANGE, exchangeCap.getValue());
        assertEquals(AssetSyncMqConfig.FULL_STORE_ROUTING_KEY, routingCap.getValue());

        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) bodyCap.getValue();
        assertNotNull(payload);
        assertEquals(123L, ((Number) payload.get("snapshotId")).longValue());
        assertEquals(42L, ((Number) payload.get("storeId")).longValue());
        assertEquals(7L, ((Number) payload.get("tenantId")).longValue());
        assertEquals(99L, ((Number) payload.get("triggeredBy")).longValue());
        assertEquals(now.toString(), payload.get("scheduledAt"));
    }

    @Test
    void onStoreConnected_swallows_exception_so_business_tx_is_not_blocked() {
        AssetSnapshotService service = mock(AssetSnapshotService.class);
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        // service 抛错——监听器不能让异常冒回去
        when(service.createFullStorePending(anyLong(), anyLong(), any()))
            .thenThrow(new RuntimeException("DB down"));

        StoreSyncListener listener = new StoreSyncListener(service, rabbit);
        // 不应抛异常
        listener.onStoreConnected(new StoreConnectedEvent(1L, 1L, null, Instant.now()));

        // service 抛了 → MQ 不应被调
        verifyNoInteractions(rabbit);
    }

    @Test
    void handle_returns_snapshot_id_for_resync_path() {
        AssetSnapshotService service = mock(AssetSnapshotService.class);
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        when(service.createFullStorePending(eq(2L), eq(5L), any())).thenReturn(456L);

        StoreSyncListener listener = new StoreSyncListener(service, rabbit);
        long id = listener.handle(new StoreConnectedEvent(5L, 2L, null, Instant.parse("2026-05-05T11:00:00Z")));

        assertEquals(456L, id);
        verify(rabbit, times(1)).convertAndSend(
            eq(RabbitMqConfig.EXCHANGE),
            eq(AssetSyncMqConfig.FULL_STORE_ROUTING_KEY),
            any(Object.class));
    }

    @Test
    void onStoreConnected_when_rabbit_throws_does_not_propagate() {
        AssetSnapshotService service = mock(AssetSnapshotService.class);
        RabbitTemplate rabbit = mock(RabbitTemplate.class);
        when(service.createFullStorePending(anyLong(), anyLong(), any())).thenReturn(11L);
        doThrow(new RuntimeException("rabbit down"))
            .when(rabbit).convertAndSend(any(String.class), any(String.class), any(Object.class));

        StoreSyncListener listener = new StoreSyncListener(service, rabbit);
        // 不抛——监听器吞了 rabbit 异常
        listener.onStoreConnected(new StoreConnectedEvent(1L, 1L, null, Instant.now()));

        verify(service, times(1)).createFullStorePending(anyLong(), anyLong(), any());
        verify(rabbit, times(1)).convertAndSend(any(String.class), any(String.class), any(Object.class));
        // 没有"二次"调用
        verify(service, never()).createFullStorePending(eq(99L), eq(99L), any());
    }
}
