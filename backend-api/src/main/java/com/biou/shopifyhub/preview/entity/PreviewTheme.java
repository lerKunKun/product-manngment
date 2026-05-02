package com.biou.shopifyhub.preview.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * W3-PV-03 / W3-PV-06：Shopify 预览主题分配。
 *
 * 用户在产品详情点 👁 → 分配一个 partner-collab dev store + 创建临时主题（PENDING）→
 * worker（W3-PV-04）异步落地 Shopify 后回填 {@link #shopifyThemeId} / {@link #previewUrl}（READY）。
 * 24h 自动过期；同一 dev store 至多 3 个活跃。
 */
@TableName(value = "preview_theme", autoResultMap = true)
public class PreviewTheme {
    @TableId(type = IdType.AUTO)
    private Long id;

    private Long tenantId;
    private Long sourceProductId;
    private Long devStoreId;

    /** worker 创建主题后回填，初始 null */
    private String shopifyThemeId;
    /** worker 创建主题后回填，初始 null */
    private String previewUrl;

    /** PENDING / BUILDING / READY / EXPIRED / FAILED */
    private String status;

    private LocalDateTime lastAccessedAt;
    private LocalDateTime expiresAt;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    private LocalDateTime completedAt;
    private String errorMessage;

    @TableLogic
    private LocalDateTime deletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getSourceProductId() { return sourceProductId; }
    public void setSourceProductId(Long sourceProductId) { this.sourceProductId = sourceProductId; }
    public Long getDevStoreId() { return devStoreId; }
    public void setDevStoreId(Long devStoreId) { this.devStoreId = devStoreId; }
    public String getShopifyThemeId() { return shopifyThemeId; }
    public void setShopifyThemeId(String shopifyThemeId) { this.shopifyThemeId = shopifyThemeId; }
    public String getPreviewUrl() { return previewUrl; }
    public void setPreviewUrl(String previewUrl) { this.previewUrl = previewUrl; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getLastAccessedAt() { return lastAccessedAt; }
    public void setLastAccessedAt(LocalDateTime lastAccessedAt) { this.lastAccessedAt = lastAccessedAt; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
