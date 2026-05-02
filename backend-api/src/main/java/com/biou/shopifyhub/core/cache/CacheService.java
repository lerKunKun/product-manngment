package com.biou.shopifyhub.core.cache;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Set;
import java.util.function.Supplier;

/**
 * W3-PERF-01：薄缓存层。
 *
 * 设计原则（与任务卡硬约束保持一致）：
 *  - <b>非阻塞</b>：Redis 任意一次操作抛错 → 仅 log warn，回退 loader / 直接返回；绝不 fail-fast 影响业务接口。
 *  - 不缓存 null（避免雪崩 / 穿透时的负缓存累计）
 *  - 不显式区分 "网络断" 与 "key 不存在"，统一走 "无缓存→loader→回写" 路径
 *  - 计数器：{@code shopifyhub.cache.hit} / {@code shopifyhub.cache.miss}，标签 {@code name}
 *
 * 不使用 Spring {@code @Cacheable} 是因为 CGLIB 自调用会让缓存失效，在显式调用更可控。
 */
@Service
public class CacheService {

    private static final Logger log = LoggerFactory.getLogger(CacheService.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final MeterRegistry meterRegistry;

    @Value("${cache.default-ttl-seconds:300}")
    private long defaultTtlSeconds;

    @Value("${cache.enabled:true}")
    private boolean enabled;

    public CacheService(StringRedisTemplate redis, ObjectMapper objectMapper, MeterRegistry meterRegistry) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.meterRegistry = meterRegistry;
    }

    /**
     * 取缓存或回源加载。命中走 hit 计数器并直接反序列化返回；未命中或异常时调 loader，
     * loader 非 null 才回写（避免负缓存）。任何 Redis 异常都被吞，仅 log warn。
     */
    public <T> T getOrLoad(String key, String cacheName, TypeReference<T> typeRef, Supplier<T> loader) {
        if (!enabled) return loader.get();
        try {
            String cached = redis.opsForValue().get(key);
            if (cached != null) {
                meterRegistry.counter("shopifyhub.cache.hit", "name", cacheName).increment();
                try {
                    return objectMapper.readValue(cached, typeRef);
                } catch (Exception parseErr) {
                    // 旧格式 / 类型变更 → 当作 miss，下面回源
                    log.warn("[cache] parse failed key={} err={} (treating as miss)", key, parseErr.getMessage());
                    safeDelete(key);
                }
            }
        } catch (Exception e) {
            log.warn("[cache] read failed key={} err={} (falling back to loader)", key, e.getMessage());
        }
        meterRegistry.counter("shopifyhub.cache.miss", "name", cacheName).increment();
        T value = loader.get();
        if (value != null) {
            try {
                String json = objectMapper.writeValueAsString(value);
                redis.opsForValue().set(key, json, Duration.ofSeconds(defaultTtlSeconds));
            } catch (Exception e) {
                log.warn("[cache] write failed key={} err={}", key, e.getMessage());
            }
        }
        return value;
    }

    /** 失效单 key。幂等，Redis 异常被吞。 */
    public void invalidate(String key) {
        if (!enabled) return;
        safeDelete(key);
    }

    /**
     * 按前缀失效。⚠️ 用 KEYS 命令，仅适合 dev / 小规模数据；生产应替换为 SCAN（Redisson client 也行）。
     * Redis 异常被吞。
     */
    public void invalidatePrefix(String prefix) {
        if (!enabled) return;
        try {
            Set<String> keys = redis.keys(prefix + "*");
            if (keys != null && !keys.isEmpty()) {
                redis.delete(keys);
            }
        } catch (Exception e) {
            log.warn("[cache] invalidatePrefix failed prefix={} err={}", prefix, e.getMessage());
        }
    }

    private void safeDelete(String key) {
        try {
            redis.delete(key);
        } catch (Exception e) {
            log.warn("[cache] invalidate failed key={} err={}", key, e.getMessage());
        }
    }
}
