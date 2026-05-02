package com.biou.shopifyhub.push.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "store_product", autoResultMap = true)
public class StoreProduct {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long storeId;
    private Long productId;
    private String shopifyProductId;
    private String shopifyHandle;

    /** NOT_PUSHED / PUSHING / ACTIVE / DRAFT / ARCHIVED / FAILED */
    private String status;

    private Long lastPushTaskId;
    private LocalDateTime lastPushedAt;
    private LocalDateTime lastPulledAt;

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
    public Long getStoreId() { return storeId; }
    public void setStoreId(Long storeId) { this.storeId = storeId; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public String getShopifyProductId() { return shopifyProductId; }
    public void setShopifyProductId(String shopifyProductId) { this.shopifyProductId = shopifyProductId; }
    public String getShopifyHandle() { return shopifyHandle; }
    public void setShopifyHandle(String shopifyHandle) { this.shopifyHandle = shopifyHandle; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getLastPushTaskId() { return lastPushTaskId; }
    public void setLastPushTaskId(Long lastPushTaskId) { this.lastPushTaskId = lastPushTaskId; }
    public LocalDateTime getLastPushedAt() { return lastPushedAt; }
    public void setLastPushedAt(LocalDateTime lastPushedAt) { this.lastPushedAt = lastPushedAt; }
    public LocalDateTime getLastPulledAt() { return lastPulledAt; }
    public void setLastPulledAt(LocalDateTime lastPulledAt) { this.lastPulledAt = lastPulledAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
