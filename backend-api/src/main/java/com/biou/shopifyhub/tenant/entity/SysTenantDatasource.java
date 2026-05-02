package com.biou.shopifyhub.tenant.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("sys_tenant_datasource")
public class SysTenantDatasource {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String jdbcUrl;
    private String username;
    private String encryptedPassword;
    private Integer poolMin;
    private Integer poolMax;
    /** ACTIVE / DISABLED */
    private String status;
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public String getJdbcUrl() { return jdbcUrl; }
    public void setJdbcUrl(String jdbcUrl) { this.jdbcUrl = jdbcUrl; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getEncryptedPassword() { return encryptedPassword; }
    public void setEncryptedPassword(String encryptedPassword) { this.encryptedPassword = encryptedPassword; }
    public Integer getPoolMin() { return poolMin; }
    public void setPoolMin(Integer poolMin) { this.poolMin = poolMin; }
    public Integer getPoolMax() { return poolMax; }
    public void setPoolMax(Integer poolMax) { this.poolMax = poolMax; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
