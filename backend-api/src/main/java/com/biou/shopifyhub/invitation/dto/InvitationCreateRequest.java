package com.biou.shopifyhub.invitation.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;
import java.util.List;

public class InvitationCreateRequest {

    @NotBlank @Email
    private String email;

    @NotNull
    private Long targetCompanyId;

    private Long targetDeptId;

    @NotEmpty(message = "至少分配一个角色")
    private List<String> roleCodes;

    @NotEmpty(message = "至少分配一个数据范围")
    private List<DataScopeItem> dataScopes;

    @NotNull(message = "账号到期时间必填")
    @Future(message = "账号到期时间必须是将来时刻")
    private LocalDateTime accountExpiresAt;

    private String note;

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public Long getTargetCompanyId() { return targetCompanyId; }
    public void setTargetCompanyId(Long targetCompanyId) { this.targetCompanyId = targetCompanyId; }
    public Long getTargetDeptId() { return targetDeptId; }
    public void setTargetDeptId(Long targetDeptId) { this.targetDeptId = targetDeptId; }
    public List<String> getRoleCodes() { return roleCodes; }
    public void setRoleCodes(List<String> roleCodes) { this.roleCodes = roleCodes; }
    public List<DataScopeItem> getDataScopes() { return dataScopes; }
    public void setDataScopes(List<DataScopeItem> dataScopes) { this.dataScopes = dataScopes; }
    public LocalDateTime getAccountExpiresAt() { return accountExpiresAt; }
    public void setAccountExpiresAt(LocalDateTime accountExpiresAt) { this.accountExpiresAt = accountExpiresAt; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }

    public static class DataScopeItem {
        /** STORE / COMPANY / PRODUCT */
        @NotBlank
        public String scopeType;
        @NotNull
        public Long scopeId;
        /** READ / WRITE */
        @NotBlank
        public String access;
    }
}
