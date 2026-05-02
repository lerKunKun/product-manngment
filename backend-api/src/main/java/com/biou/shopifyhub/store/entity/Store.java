package com.biou.shopifyhub.store.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "store", autoResultMap = true)
public class Store {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long deptId;
    private String myshopifyDomain;
    private String customDomain;
    private String brandName;

    /** cli / custom_app / oauth */
    private String tokenType;
    private String encryptedAccessToken;
    private String encryptedRefreshToken;
    private LocalDateTime expiresAt;
    private String scopes;
    private LocalDateTime lastRefreshAt;

    private Boolean isDevStore;
    private Boolean isPartnerCollab;

    /** ACTIVE / DISABLED / TOKEN_EXPIRED / UNINSTALLED */
    private String status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
    @TableLogic
    private LocalDateTime deletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getDeptId() { return deptId; }
    public void setDeptId(Long deptId) { this.deptId = deptId; }
    public String getMyshopifyDomain() { return myshopifyDomain; }
    public void setMyshopifyDomain(String myshopifyDomain) { this.myshopifyDomain = myshopifyDomain; }
    public String getCustomDomain() { return customDomain; }
    public void setCustomDomain(String customDomain) { this.customDomain = customDomain; }
    public String getBrandName() { return brandName; }
    public void setBrandName(String brandName) { this.brandName = brandName; }
    public String getTokenType() { return tokenType; }
    public void setTokenType(String tokenType) { this.tokenType = tokenType; }
    public String getEncryptedAccessToken() { return encryptedAccessToken; }
    public void setEncryptedAccessToken(String encryptedAccessToken) { this.encryptedAccessToken = encryptedAccessToken; }
    public String getEncryptedRefreshToken() { return encryptedRefreshToken; }
    public void setEncryptedRefreshToken(String encryptedRefreshToken) { this.encryptedRefreshToken = encryptedRefreshToken; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
    public String getScopes() { return scopes; }
    public void setScopes(String scopes) { this.scopes = scopes; }
    public LocalDateTime getLastRefreshAt() { return lastRefreshAt; }
    public void setLastRefreshAt(LocalDateTime lastRefreshAt) { this.lastRefreshAt = lastRefreshAt; }
    public Boolean getIsDevStore() { return isDevStore; }
    public void setIsDevStore(Boolean isDevStore) { this.isDevStore = isDevStore; }
    public Boolean getIsPartnerCollab() { return isPartnerCollab; }
    public void setIsPartnerCollab(Boolean isPartnerCollab) { this.isPartnerCollab = isPartnerCollab; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
