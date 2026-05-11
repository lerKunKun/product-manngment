package com.biou.shopifyhub.invitation.dto;

import java.time.LocalDateTime;

public class InvitationListItem {
    private Long id;
    private String email;
    private String status;
    private LocalDateTime invitedAt;
    private LocalDateTime accountExpiresAt;
    private LocalDateTime linkExpiresAt;
    private LocalDateTime acceptedAt;
    private Long invitedBy;
    private Long createdUserId;
    /** sys_user.status（ACTIVE / FROZEN / EXPIRED / DELETED），仅 status=ACCEPTED 时有值 */
    private String userStatus;
    /** sys_user.deleted_at（被 soft-delete 时间戳），仅 status=ACCEPTED 时有值 */
    private LocalDateTime userDeletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getInvitedAt() { return invitedAt; }
    public void setInvitedAt(LocalDateTime invitedAt) { this.invitedAt = invitedAt; }
    public LocalDateTime getAccountExpiresAt() { return accountExpiresAt; }
    public void setAccountExpiresAt(LocalDateTime accountExpiresAt) { this.accountExpiresAt = accountExpiresAt; }
    public LocalDateTime getLinkExpiresAt() { return linkExpiresAt; }
    public void setLinkExpiresAt(LocalDateTime linkExpiresAt) { this.linkExpiresAt = linkExpiresAt; }
    public LocalDateTime getAcceptedAt() { return acceptedAt; }
    public void setAcceptedAt(LocalDateTime acceptedAt) { this.acceptedAt = acceptedAt; }
    public Long getInvitedBy() { return invitedBy; }
    public void setInvitedBy(Long invitedBy) { this.invitedBy = invitedBy; }
    public Long getCreatedUserId() { return createdUserId; }
    public void setCreatedUserId(Long createdUserId) { this.createdUserId = createdUserId; }
    public String getUserStatus() { return userStatus; }
    public void setUserStatus(String userStatus) { this.userStatus = userStatus; }
    public LocalDateTime getUserDeletedAt() { return userDeletedAt; }
    public void setUserDeletedAt(LocalDateTime userDeletedAt) { this.userDeletedAt = userDeletedAt; }
}
