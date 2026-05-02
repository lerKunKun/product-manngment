package com.biou.shopifyhub.purchase.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "sku_change_log", autoResultMap = true)
public class SkuChangeLog {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long variantId;
    private Long productId;
    private String oldSku;
    private String newSku;
    private Long changedBy;
    private LocalDateTime confirmedAt;
    /** PENDING / SUCCESS / PARTIAL / FAILED */
    private String syncStatus;
    private String syncResult;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getVariantId() { return variantId; }
    public void setVariantId(Long variantId) { this.variantId = variantId; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public String getOldSku() { return oldSku; }
    public void setOldSku(String oldSku) { this.oldSku = oldSku; }
    public String getNewSku() { return newSku; }
    public void setNewSku(String newSku) { this.newSku = newSku; }
    public Long getChangedBy() { return changedBy; }
    public void setChangedBy(Long changedBy) { this.changedBy = changedBy; }
    public LocalDateTime getConfirmedAt() { return confirmedAt; }
    public void setConfirmedAt(LocalDateTime confirmedAt) { this.confirmedAt = confirmedAt; }
    public String getSyncStatus() { return syncStatus; }
    public void setSyncStatus(String syncStatus) { this.syncStatus = syncStatus; }
    public String getSyncResult() { return syncResult; }
    public void setSyncResult(String syncResult) { this.syncResult = syncResult; }
}
