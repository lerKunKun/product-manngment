package com.biou.shopifyhub.asset.sync;

import java.time.Instant;

/**
 * 店铺接入完成事件（AS1-01）。
 *
 * <p>由 {@code StoreService.connectCustomApp} 与 OAuth 回调在事务提交后发布；
 * 由 {@link StoreSyncListener} 监听，进而创建 FULL+PENDING 快照 + 投 MQ。
 *
 * <p>跨模块通信走事件 → MQ，遵循 CLAUDE.md「跨模块走 MQ」约束。
 */
public record StoreConnectedEvent(
    long storeId,
    long tenantId,
    Long triggeredBy,
    Instant connectedAt
) {
}
