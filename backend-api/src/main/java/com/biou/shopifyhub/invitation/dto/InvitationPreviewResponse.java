package com.biou.shopifyhub.invitation.dto;

import java.time.LocalDateTime;
import java.util.List;

public class InvitationPreviewResponse {
    private String email;
    private String companyName;
    private String deptName;
    private List<String> roleNames;
    private LocalDateTime accountExpiresAt;
    private String invitedByName;
    private LocalDateTime invitedAt;

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getCompanyName() { return companyName; }
    public void setCompanyName(String companyName) { this.companyName = companyName; }
    public String getDeptName() { return deptName; }
    public void setDeptName(String deptName) { this.deptName = deptName; }
    public List<String> getRoleNames() { return roleNames; }
    public void setRoleNames(List<String> roleNames) { this.roleNames = roleNames; }
    public LocalDateTime getAccountExpiresAt() { return accountExpiresAt; }
    public void setAccountExpiresAt(LocalDateTime accountExpiresAt) { this.accountExpiresAt = accountExpiresAt; }
    public String getInvitedByName() { return invitedByName; }
    public void setInvitedByName(String invitedByName) { this.invitedByName = invitedByName; }
    public LocalDateTime getInvitedAt() { return invitedAt; }
    public void setInvitedAt(LocalDateTime invitedAt) { this.invitedAt = invitedAt; }
}
