package com.biou.shopifyhub.core.mq;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class RabbitMqConfig {

    public static final String EXCHANGE = "shub.events";

    public static final String DINGTALK_SYNC_QUEUE = "dingtalk.sync";
    public static final String DINGTALK_SYNC_ROUTING = "dingtalk.sync.#";

    // ===== W2-SNAP-03: Snapshot debounce/delay topology =====
    public static final String SNAPSHOT_DELAY_EXCHANGE = "shub.snapshot.delay";
    public static final String SNAPSHOT_DELAY_QUEUE = "snap.delay";
    public static final String SNAPSHOT_PROCESS_EXCHANGE = "shub.snapshot.process";
    public static final String SNAPSHOT_PROCESS_QUEUE = "snap.process";
    public static final String SNAPSHOT_PROCESS_ROUTING_KEY = "snap.process";

    @Bean
    public TopicExchange shubExchange() {
        return new TopicExchange(EXCHANGE, true, false);
    }

    @Bean
    public Queue dingtalkSyncQueue() {
        return new Queue(DINGTALK_SYNC_QUEUE, true);
    }

    @Bean
    public Binding dingtalkSyncBinding() {
        return BindingBuilder.bind(dingtalkSyncQueue()).to(shubExchange()).with(DINGTALK_SYNC_ROUTING);
    }

    // ===== Snapshot delay (TTL queue, no consumer) =====

    @Bean
    public DirectExchange snapshotDelayExchange() {
        return new DirectExchange(SNAPSHOT_DELAY_EXCHANGE, true, false);
    }

    /**
     * Delay queue: messages sit here for {@code shopify.snapshot.debounce-seconds} seconds,
     * then are dead-lettered to the process exchange. No consumer attached.
     */
    @Bean
    public Queue snapDelayQueue(@Value("${shopify.snapshot.debounce-seconds:300}") long ttlSeconds) {
        Map<String, Object> args = new HashMap<>();
        args.put("x-message-ttl", ttlSeconds * 1000L);
        args.put("x-dead-letter-exchange", SNAPSHOT_PROCESS_EXCHANGE);
        args.put("x-dead-letter-routing-key", SNAPSHOT_PROCESS_ROUTING_KEY);
        return new Queue(SNAPSHOT_DELAY_QUEUE, true, false, false, args);
    }

    @Bean
    public Binding snapshotDelayBinding(Queue snapDelayQueue, DirectExchange snapshotDelayExchange) {
        return BindingBuilder.bind(snapDelayQueue).to(snapshotDelayExchange).with(SNAPSHOT_PROCESS_ROUTING_KEY);
    }

    // ===== Snapshot process (consumer) =====

    @Bean
    public DirectExchange snapshotProcessExchange() {
        return new DirectExchange(SNAPSHOT_PROCESS_EXCHANGE, true, false);
    }

    @Bean
    public Queue snapProcessQueue() {
        return new Queue(SNAPSHOT_PROCESS_QUEUE, true);
    }

    @Bean
    public Binding snapshotProcessBinding(Queue snapProcessQueue, DirectExchange snapshotProcessExchange) {
        return BindingBuilder.bind(snapProcessQueue).to(snapshotProcessExchange).with(SNAPSHOT_PROCESS_ROUTING_KEY);
    }

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }
}
