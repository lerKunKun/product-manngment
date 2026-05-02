package com.biou.shopifyhub.tenant.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 应用启动后自动加载所有 ACTIVE 租户数据源。
 * <p>
 * 失败不阻断启动 —— 平台库 /api 仍能用；个别租户连接失败由管理端 reload 重试。
 */
@Component
@Order(0)
public class TenantDataSourceBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(TenantDataSourceBootstrap.class);

    private final TenantDataSourceManager manager;

    public TenantDataSourceBootstrap(TenantDataSourceManager manager) {
        this.manager = manager;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            Map<String, Integer> r = manager.reload();
            log.info("租户数据源启动加载完成：added={} skipped={} total_active={}",
                r.get("added"), r.get("skipped"), r.getOrDefault("total_active", 0));
        } catch (Exception e) {
            log.warn("租户数据源启动加载失败（不阻断主流程）：{}", e.getMessage());
        }
    }
}
