package com.biou.shopifyhub.core.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("sys_user")
public class SysUser {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String employeeNo;
    private String username;
    private String passwordHash;
    private Boolean passwordMustChange;
    private String email;
    private String phone;
    private String dingtalkUnionid;
    private String dingtalkUserid;
    private String dingtalkCorpId;
    private Long defaultTenantId;
    private String avatarUrl;
    private String position;
    /** STAFF / TEMP */
    private String userType;
    /** 仅 TEMP：账号到期时间 */
    private LocalDateTime expiresAt;
    /** ACTIVE / FROZEN / DELETED / EXPIRED */
    private String status;
    private LocalDateTime frozenAt;
    private LocalDateTime expiredAt;
    private Long invitedBy;
    private Long invitationId;
    private LocalDateTime lastLoginAt;
    private String lastLoginIp;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private LocalDateTime deletedAt;

    // getters / setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getEmployeeNo() { return employeeNo; }
    public void setEmployeeNo(String employeeNo) { this.employeeNo = employeeNo; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public Boolean getPasswordMustChange() { return passwordMustChange; }
    public void setPasswordMustChange(Boolean passwordMustChange) { this.passwordMustChange = passwordMustChange; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
    public String getDingtalkUnionid() { return dingtalkUnionid; }
    public void setDingtalkUnionid(String dingtalkUnionid) { this.dingtalkUnionid = dingtalkUnionid; }
    public String getDingtalkUserid() { return dingtalkUserid; }
    public void setDingtalkUserid(String dingtalkUserid) { this.dingtalkUserid = dingtalkUserid; }
    public String getDingtalkCorpId() { return dingtalkCorpId; }
    public void setDingtalkCorpId(String dingtalkCorpId) { this.dingtalkCorpId = dingtalkCorpId; }
    public Long getDefaultTenantId() { return defaultTenantId; }
    public void setDefaultTenantId(Long defaultTenantId) { this.defaultTenantId = defaultTenantId; }
    public String getAvatarUrl() { return avatarUrl; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }
    public String getPosition() { return position; }
    public void setPosition(String position) { this.position = position; }
    public String getUserType() { return userType; }
    public void setUserType(String userType) { this.userType = userType; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getFrozenAt() { return frozenAt; }
    public void setFrozenAt(LocalDateTime frozenAt) { this.frozenAt = frozenAt; }
    public LocalDateTime getExpiredAt() { return expiredAt; }
    public void setExpiredAt(LocalDateTime expiredAt) { this.expiredAt = expiredAt; }
    public Long getInvitedBy() { return invitedBy; }
    public void setInvitedBy(Long invitedBy) { this.invitedBy = invitedBy; }
    public Long getInvitationId() { return invitationId; }
    public void setInvitationId(Long invitationId) { this.invitationId = invitationId; }
    public LocalDateTime getLastLoginAt() { return lastLoginAt; }
    public void setLastLoginAt(LocalDateTime lastLoginAt) { this.lastLoginAt = lastLoginAt; }
    public String getLastLoginIp() { return lastLoginIp; }
    public void setLastLoginIp(String lastLoginIp) { this.lastLoginIp = lastLoginIp; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
