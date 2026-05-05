package com.biou.shopifyhub.asset.sync;

import com.biou.shopifyhub.core.mq.RabbitMqConfig;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * asset.sync 模块的 MQ 拓扑（AS1-02）。
 *
 * <p>复用平台主交换机 {@link RabbitMqConfig#EXCHANGE shub.events}（topic）。
 * 路由键 {@code asset.sync.fullStore} 上绑定持久队列 {@code asset.sync.fullStore}，
 * 由 {@link SyncConsumer} 消费。
 */
@Configuration
public class AssetSyncMqConfig {

    public static final String FULL_STORE_QUEUE = "asset.sync.fullStore";
    public static final String FULL_STORE_ROUTING_KEY = "asset.sync.fullStore";

    @Bean
    public Queue assetSyncFullStoreQueue() {
        return new Queue(FULL_STORE_QUEUE, true);
    }

    @Bean
    public Binding assetSyncFullStoreBinding(Queue assetSyncFullStoreQueue, TopicExchange shubExchange) {
        return BindingBuilder.bind(assetSyncFullStoreQueue)
            .to(shubExchange)
            .with(FULL_STORE_ROUTING_KEY);
    }
}
