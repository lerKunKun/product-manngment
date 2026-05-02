package com.biou.shopifyhub.invitation.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "user_invitation", autoResultMap = true)
public class UserInvitation {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String email;
    private Long targetCompanyId;
    private Long targetDeptId;
    /** JSON：邀请时分配的角色 code 列表 */
    private String roleCodes;
    /** JSON：邀请时分配的数据范围 */
    private String dataScopes;
    /** 临时账号到期时间（必填，最长 90 天） */
    private LocalDateTime accountExpiresAt;
    private String invitationToken;
    /** 邀请链接 48h 有效 */
    private LocalDateTime linkExpiresAt;
    private String initialPasswordHash;
    /** PENDING / ACCEPTED / LINK_EXPIRED / REVOKED */
    private String status;
    private Long invitedBy;
    private LocalDateTime invitedAt;
    private LocalDateTime acceptedAt;
    private Long createdUserId;
    private Long revokedBy;
    private LocalDateTime revokedAt;
    private String revokeReason;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public Long getTargetCompanyId() { return targetCompanyId; }
    public void setTargetCompanyId(Long targetCompanyId) { this.targetCompanyId = targetCompanyId; }
    public Long getTargetDeptId() { return targetDeptId; }
    public void setTargetDeptId(Long targetDeptId) { this.targetDeptId = targetDeptId; }
    public String getRoleCodes() { return roleCodes; }
    public void setRoleCodes(String roleCodes) { this.roleCodes = roleCodes; }
    public String getDataScopes() { return dataScopes; }
    public void setDataScopes(String dataScopes) { this.dataScopes = dataScopes; }
    public LocalDateTime getAccountExpiresAt() { return accountExpiresAt; }
    public void setAccountExpiresAt(LocalDateTime accountExpiresAt) { this.accountExpiresAt = accountExpiresAt; }
    public String getInvitationToken() { return invitationToken; }
    public void setInvitationToken(String invitationToken) { this.invitationToken = invitationToken; }
    public LocalDateTime getLinkExpiresAt() { return linkExpiresAt; }
    public void setLinkExpiresAt(LocalDateTime linkExpiresAt) { this.linkExpiresAt = linkExpiresAt; }
    public String getInitialPasswordHash() { return initialPasswordHash; }
    public void setInitialPasswordHash(String initialPasswordHash) { this.initialPasswordHash = initialPasswordHash; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getInvitedBy() { return invitedBy; }
    public void setInvitedBy(Long invitedBy) { this.invitedBy = invitedBy; }
    public LocalDateTime getInvitedAt() { return invitedAt; }
    public void setInvitedAt(LocalDateTime invitedAt) { this.invitedAt = invitedAt; }
    public LocalDateTime getAcceptedAt() { return acceptedAt; }
    public void setAcceptedAt(LocalDateTime acceptedAt) { this.acceptedAt = acceptedAt; }
    public Long getCreatedUserId() { return createdUserId; }
    public void setCreatedUserId(Long createdUserId) { this.createdUserId = createdUserId; }
    public Long getRevokedBy() { return revokedBy; }
    public void setRevokedBy(Long revokedBy) { this.revokedBy = revokedBy; }
    public LocalDateTime getRevokedAt() { return revokedAt; }
    public void setRevokedAt(LocalDateTime revokedAt) { this.revokedAt = revokedAt; }
    public String getRevokeReason() { return revokeReason; }
    public void setRevokeReason(String revokeReason) { this.revokeReason = revokeReason; }
}
