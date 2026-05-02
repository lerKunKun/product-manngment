package com.biou.shopifyhub.tenant.service;

import com.baomidou.dynamic.datasource.DynamicRoutingDataSource;
import com.baomidou.dynamic.datasource.creator.DataSourceProperty;
import com.baomidou.dynamic.datasource.creator.DefaultDataSourceCreator;
import com.baomidou.dynamic.datasource.creator.hikaricp.HikariCpConfig;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.security.AesGcmUtil;
import com.biou.shopifyhub.tenant.entity.SysTenant;
import com.biou.shopifyhub.tenant.entity.SysTenantDatasource;
import com.biou.shopifyhub.tenant.mapper.SysTenantDatasourceMapper;
import com.biou.shopifyhub.tenant.mapper.SysTenantMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 多租户数据源运行时加载器（W1-CORE-01）。
 * <p>
 * 启动时从 sys_tenant + sys_tenant_datasource 读 ACTIVE 行，按 datasource_key 注册到
 * 框架的 DynamicRoutingDataSource；后续可通过 reload() 热更新。
 * <p>
 * 业务代码用 {@code @DS("tenant_01")} 切换；platform 是 application-dev.yml 静态配置的主库。
 */
@Service
public class TenantDataSourceManager {

    private static final Logger log = LoggerFactory.getLogger(TenantDataSourceManager.class);

    private final DataSource routingDataSource;
    private final DefaultDataSourceCreator dataSourceCreator;
    private final SysTenantMapper tenantMapper;
    private final SysTenantDatasourceMapper datasourceMapper;

    @Value("${ENCRYPT_KEY_AES_GCM:}")
    private String aesKey;

    public TenantDataSourceManager(DataSource routingDataSource,
                                   DefaultDataSourceCreator dataSourceCreator,
                                   SysTenantMapper tenantMapper,
                                   SysTenantDatasourceMapper datasourceMapper) {
        this.routingDataSource = routingDataSource;
        this.dataSourceCreator = dataSourceCreator;
        this.tenantMapper = tenantMapper;
        this.datasourceMapper = datasourceMapper;
    }

    /** 启动 + 管理端调用：把 sys_tenant_datasource ACTIVE 行注册成动态数据源。返回 (added, skipped)。 */
    public Map<String, Integer> reload() {
        if (!(routingDataSource instanceof DynamicRoutingDataSource dyn)) {
            log.warn("数据源不是 DynamicRoutingDataSource，跳过租户数据源注册：{}", routingDataSource.getClass());
            return Map.of("added", 0, "skipped", 0);
        }
        Map<String, DataSource> existing = dyn.getDataSources();
        List<SysTenant> tenants = tenantMapper.selectList(
            new QueryWrapper<SysTenant>().eq("status", "ACTIVE"));
        if (tenants.isEmpty()) {
            log.info("sys_tenant 无 ACTIVE 行，跳过租户数据源加载");
            return Map.of("added", 0, "skipped", 0);
        }
        Map<Long, String> tenantIdToKey = new HashMap<>();
        for (SysTenant t : tenants) tenantIdToKey.put(t.getId(), t.getDatasourceKey());

        List<SysTenantDatasource> rows = datasourceMapper.selectList(
            new QueryWrapper<SysTenantDatasource>()
                .in("tenant_id", new ArrayList<>(tenantIdToKey.keySet()))
                .eq("status", "ACTIVE"));

        int added = 0, skipped = 0;
        for (SysTenantDatasource row : rows) {
            String key = tenantIdToKey.get(row.getTenantId());
            if (key == null || key.isBlank()) { skipped++; continue; }
            if (existing.containsKey(key)) {
                log.debug("数据源 {} 已存在，跳过", key);
                skipped++;
                continue;
            }
            try {
                DataSource ds = build(row);
                dyn.addDataSource(key, ds);
                added++;
                log.info("注册租户数据源 key={} url={}", key, mask(row.getJdbcUrl()));
            } catch (Exception e) {
                log.error("注册租户数据源失败 tenantId={} key={}: {}", row.getTenantId(), key, e.getMessage());
                skipped++;
            }
        }
        return Map.of("added", added, "skipped", skipped, "total_active", rows.size());
    }

    /** 单租户重载（管理端 API 用）。返回是否注册/替换成功。 */
    public boolean register(Long tenantId) {
        SysTenant t = tenantMapper.selectById(tenantId);
        if (t == null || !"ACTIVE".equals(t.getStatus())) {
            log.warn("tenantId={} 不存在或非 ACTIVE，拒绝注册", tenantId);
            return false;
        }
        SysTenantDatasource row = datasourceMapper.selectOne(
            new QueryWrapper<SysTenantDatasource>().eq("tenant_id", tenantId));
        if (row == null || !"ACTIVE".equals(row.getStatus())) {
            log.warn("tenantId={} 数据源不存在或非 ACTIVE", tenantId);
            return false;
        }
        if (!(routingDataSource instanceof DynamicRoutingDataSource dyn)) return false;

        if (dyn.getDataSources().containsKey(t.getDatasourceKey())) {
            dyn.removeDataSource(t.getDatasourceKey());
        }
        DataSource ds = build(row);
        dyn.addDataSource(t.getDatasourceKey(), ds);
        log.info("重载租户数据源 key={} tenantId={}", t.getDatasourceKey(), tenantId);
        return true;
    }

    /** 注销租户数据源（DISABLED / 删除时用）。 */
    public boolean remove(String key) {
        if (!(routingDataSource instanceof DynamicRoutingDataSource dyn)) return false;
        if ("platform".equals(key)) {
            log.warn("拒绝注销主库 platform");
            return false;
        }
        if (!dyn.getDataSources().containsKey(key)) return false;
        dyn.removeDataSource(key);
        log.info("注销租户数据源 key={}", key);
        return true;
    }

    /** 当前已注册数据源 key 列表（管理端 API 展示）。 */
    public List<String> registeredKeys() {
        if (!(routingDataSource instanceof DynamicRoutingDataSource dyn)) return Collections.emptyList();
        return new ArrayList<>(dyn.getDataSources().keySet());
    }

    private DataSource build(SysTenantDatasource row) {
        DataSourceProperty p = new DataSourceProperty();
        p.setUrl(row.getJdbcUrl());
        p.setUsername(row.getUsername());
        p.setPassword(decryptPassword(row.getEncryptedPassword()));
        p.setDriverClassName("com.mysql.cj.jdbc.Driver");
        // 懒加载：连接到第一次使用时建立，租户库不可达不阻断启动
        p.setLazy(true);

        HikariCpConfig hikari = new HikariCpConfig();
        if (row.getPoolMin() != null) hikari.setMinIdle(row.getPoolMin());
        if (row.getPoolMax() != null) hikari.setMaxPoolSize(row.getPoolMax());
        p.setHikari(hikari);
        return dataSourceCreator.createDataSource(p);
    }

    private String decryptPassword(String enc) {
        if (enc == null || enc.isBlank()) return "";
        if (aesKey == null || aesKey.isBlank()) {
            throw new IllegalStateException("ENCRYPT_KEY_AES_GCM 未配置，无法解密 sys_tenant_datasource.encrypted_password");
        }
        return AesGcmUtil.decrypt(enc, aesKey);
    }

    private String mask(String url) {
        if (url == null) return null;
        int q = url.indexOf('?');
        return q > 0 ? url.substring(0, q) + "?…" : url;
    }
}
