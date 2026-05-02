package com.biou.shopifyhub.approval.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;

import java.time.LocalDateTime;
import java.util.Map;

@TableName(value = "approval_log", autoResultMap = true)
public class ApprovalLog {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long flowId;
    private Long actorId;
    /** SUBMIT / APPROVE / REJECT / RESUBMIT / CANCEL */
    private String action;

    @TableField("`comment`")
    private String comment;

    @TableField(value = "payload_snapshot", typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> payloadSnapshot;

    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getFlowId() { return flowId; }
    public void setFlowId(Long flowId) { this.flowId = flowId; }
    public Long getActorId() { return actorId; }
    public void setActorId(Long actorId) { this.actorId = actorId; }
    public String getAction() { return action; }
    public void setAction(String action) { this.action = action; }
    public String getComment() { return comment; }
    public void setComment(String comment) { this.comment = comment; }
    public Map<String, Object> getPayloadSnapshot() { return payloadSnapshot; }
    public void setPayloadSnapshot(Map<String, Object> payloadSnapshot) { this.payloadSnapshot = payloadSnapshot; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
