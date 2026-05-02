package com.biou.shopifyhub.push.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "task", autoResultMap = true)
public class Task {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;

    /** PRODUCT_PUSH / PRODUCT_PULL / THEME_PULL / POLICY_PULL / MENU_PULL / COLLECTION_PULL / SNAPSHOT / PREVIEW / NEW_STORE_SAGA / OTHER */
    private String type;

    /** PENDING / RUNNING / SUCCESS / FAILED / PARTIAL / CANCELED */
    private String status;

    private Long storeId;
    private String payloadJson;
    private String resultJson;
    private String errorMessage;
    private Long triggeredBy;
    private Long parentTaskId;

    /** Saga step name (null for non-saga tasks). See {@code SagaStep}. */
    private String sagaStep;
    /** Accumulated saga context JSON (output of completed steps / input to next). */
    private String sagaDataJson;
    /** Retry attempt count for the current saga step (0 = first run). */
    private Integer sagaAttempt;

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
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getStoreId() { return storeId; }
    public void setStoreId(Long storeId) { this.storeId = storeId; }
    public String getPayloadJson() { return payloadJson; }
    public void setPayloadJson(String payloadJson) { this.payloadJson = payloadJson; }
    public String getResultJson() { return resultJson; }
    public void setResultJson(String resultJson) { this.resultJson = resultJson; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public Long getTriggeredBy() { return triggeredBy; }
    public void setTriggeredBy(Long triggeredBy) { this.triggeredBy = triggeredBy; }
    public Long getParentTaskId() { return parentTaskId; }
    public void setParentTaskId(Long parentTaskId) { this.parentTaskId = parentTaskId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
    public String getSagaStep() { return sagaStep; }
    public void setSagaStep(String sagaStep) { this.sagaStep = sagaStep; }
    public String getSagaDataJson() { return sagaDataJson; }
    public void setSagaDataJson(String sagaDataJson) { this.sagaDataJson = sagaDataJson; }
    public Integer getSagaAttempt() { return sagaAttempt; }
    public void setSagaAttempt(Integer sagaAttempt) { this.sagaAttempt = sagaAttempt; }
}
