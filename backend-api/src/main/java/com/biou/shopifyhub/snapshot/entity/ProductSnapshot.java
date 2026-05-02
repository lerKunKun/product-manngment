package com.biou.shopifyhub.snapshot.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "product_snapshot", autoResultMap = true)
public class ProductSnapshot {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long storeId;
    private String productExternalId;
    private Long productId;

    /** WEBHOOK_UPDATE / MANUAL / SCHEDULE / PUSH_DONE */
    private String triggerEvent;

    /** PENDING / RUNNING / SUCCESS / FAILED */
    private String status;

    private String csvR2Key;
    private String jsonR2Key;
    private String diffSummaryJson;
    private Long totalBytes;
    private String errorMessage;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    private LocalDateTime startedAt;
    private LocalDateTime completedAt;
    @TableLogic
    private LocalDateTime deletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getStoreId() { return storeId; }
    public void setStoreId(Long storeId) { this.storeId = storeId; }
    public String getProductExternalId() { return productExternalId; }
    public void setProductExternalId(String productExternalId) { this.productExternalId = productExternalId; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public String getTriggerEvent() { return triggerEvent; }
    public void setTriggerEvent(String triggerEvent) { this.triggerEvent = triggerEvent; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getCsvR2Key() { return csvR2Key; }
    public void setCsvR2Key(String csvR2Key) { this.csvR2Key = csvR2Key; }
    public String getJsonR2Key() { return jsonR2Key; }
    public void setJsonR2Key(String jsonR2Key) { this.jsonR2Key = jsonR2Key; }
    public String getDiffSummaryJson() { return diffSummaryJson; }
    public void setDiffSummaryJson(String diffSummaryJson) { this.diffSummaryJson = diffSummaryJson; }
    public Long getTotalBytes() { return totalBytes; }
    public void setTotalBytes(Long totalBytes) { this.totalBytes = totalBytes; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
