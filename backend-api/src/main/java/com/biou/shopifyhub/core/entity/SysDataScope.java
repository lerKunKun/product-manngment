package com.biou.shopifyhub.core.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("sys_data_scope")
public class SysDataScope {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    /** STORE / COMPANY / PRODUCT */
    private String scopeType;
    private Long scopeId;
    /** READ / WRITE */
    private String access;
    private Long grantedBy;
    /** W3-DS-01: 授权方公司 id（跨公司授权时填，邀请来源可空） */
    private Long granterCompanyId;
    private LocalDateTime grantedAt;
    private LocalDateTime expiresAt;
    /** W3-DS-01: 撤销时间（REVOKED 时填） */
    private LocalDateTime revokedAt;
    /** W3-DS-03: 24h 内即将过期的提醒时间（dedupe，避免每小时重复发） */
    private LocalDateTime expiringNotifiedAt;
    private Long approvalId;
    /** CROSS_AUTH / INVITATION / APPROVAL */
    private String source;
    /** W3-DS-01: 是否跨公司授权（1=跨公司，需带 expires_at） */
    private Boolean crossCompany;
    /** ACTIVE / EXPIRING / EXPIRED / REVOKED */
    private String status;
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getScopeType() { return scopeType; }
    public void setScopeType(String scopeType) { this.scopeType = scopeType; }
    public Long getScopeId() { return scopeId; }
    public void setScopeId(Long scopeId) { this.scopeId = scopeId; }
    public String getAccess() { return access; }
    public void setAccess(String access) { this.access = access; }
    public Long getGrantedBy() { return grantedBy; }
    public void setGrantedBy(Long grantedBy) { this.grantedBy = grantedBy; }
    public Long getGranterCompanyId() { return granterCompanyId; }
    public void setGranterCompanyId(Long granterCompanyId) { this.granterCompanyId = granterCompanyId; }
    public LocalDateTime getGrantedAt() { return grantedAt; }
    public void setGrantedAt(LocalDateTime grantedAt) { this.grantedAt = grantedAt; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
    public LocalDateTime getRevokedAt() { return revokedAt; }
    public void setRevokedAt(LocalDateTime revokedAt) { this.revokedAt = revokedAt; }
    public LocalDateTime getExpiringNotifiedAt() { return expiringNotifiedAt; }
    public void setExpiringNotifiedAt(LocalDateTime expiringNotifiedAt) { this.expiringNotifiedAt = expiringNotifiedAt; }
    public Long getApprovalId() { return approvalId; }
    public void setApprovalId(Long approvalId) { this.approvalId = approvalId; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public Boolean getCrossCompany() { return crossCompany; }
    public void setCrossCompany(Boolean crossCompany) { this.crossCompany = crossCompany; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
