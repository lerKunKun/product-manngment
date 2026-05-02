package com.biou.shopifyhub.core.metrics;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.approval.entity.ApprovalFlow;
import com.biou.shopifyhub.approval.mapper.ApprovalFlowMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 每分钟扫一次最久 PENDING 审批，刷新 gauge {@code shopifyhub_approval_pending_max_age_seconds}。
 */
@Component
public class ApprovalMetricsExporter {

    private final ApprovalFlowMapper flowMapper;
    private final AtomicLong pendingMaxAge = new AtomicLong(0);

    public ApprovalMetricsExporter(ApprovalFlowMapper flowMapper, MeterRegistry registry) {
        this.flowMapper = flowMapper;
        registry.gauge("shopifyhub_approval_pending_max_age_seconds", pendingMaxAge);
    }

    @Scheduled(cron = "0 * * * * *")
    public void refresh() {
        ApprovalFlow oldest = flowMapper.selectOne(
            new LambdaQueryWrapper<ApprovalFlow>()
                .eq(ApprovalFlow::getStatus, "PENDING")
                .orderByAsc(ApprovalFlow::getCreatedAt)
                .last("LIMIT 1"));
        long age = (oldest == null || oldest.getCreatedAt() == null)
            ? 0
            : Duration.between(oldest.getCreatedAt(), LocalDateTime.now()).getSeconds();
        pendingMaxAge.set(Math.max(0, age));
    }
}
