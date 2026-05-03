package com.biou.shopifyhub.org.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 组织级钉钉应用配置（per-COMPANY 一对一）。
 * org_id 直接复用 sys_org.id 作主键，每个 COMPANY 节点最多一条。
 * app_secret_enc 是 AES-GCM 加密后的 base64，永远不会以明文返回 / 入日志。
 */
@TableName("sys_org_dingtalk_config")
public class SysOrgDingtalkConfig {
    @TableId(type = IdType.INPUT)
    private Long orgId;
    private String corpId;
    private String appKey;
    private String appSecretEnc;
    private String agentId;
    private String eventToken;
    private String eventAesKey;
    /** ACTIVE / DISABLED */
    private String status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    public Long getOrgId() { return orgId; }
    public void setOrgId(Long orgId) { this.orgId = orgId; }
    public String getCorpId() { return corpId; }
    public void setCorpId(String corpId) { this.corpId = corpId; }
    public String getAppKey() { return appKey; }
    public void setAppKey(String appKey) { this.appKey = appKey; }
    public String getAppSecretEnc() { return appSecretEnc; }
    public void setAppSecretEnc(String appSecretEnc) { this.appSecretEnc = appSecretEnc; }
    public String getAgentId() { return agentId; }
    public void setAgentId(String agentId) { this.agentId = agentId; }
    public String getEventToken() { return eventToken; }
    public void setEventToken(String eventToken) { this.eventToken = eventToken; }
    public String getEventAesKey() { return eventAesKey; }
    public void setEventAesKey(String eventAesKey) { this.eventAesKey = eventAesKey; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
