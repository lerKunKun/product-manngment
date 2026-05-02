package com.biou.shopifyhub.invitation.dto;

import jakarta.validation.constraints.NotBlank;

public class InvitationAcceptRequest {

    @NotBlank
    private String token;

    @NotBlank
    private String tempPassword;

    public String getToken() { return token; }
    public void setToken(String token) { this.token = token; }
    public String getTempPassword() { return tempPassword; }
    public void setTempPassword(String tempPassword) { this.tempPassword = tempPassword; }
}
