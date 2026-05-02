package com.biou.shopifyhub.invitation;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "invitation")
public class InvitationProperties {
    /** 接受邀请落地页基址，邮件中拼 token 拼接成完整 URL */
    private String linkBase = "http://localhost:3000/invitation/accept";
    /** 邀请链接有效期（小时） */
    private int linkTtlHours = 48;
    /** 临时账号最长有效期（天） */
    private int maxAccountDays = 90;
    /** HMAC 用的 secret，dev 默认；生产 .env 注入 */
    private String tokenSecret = "dev-invitation-secret-please-change-in-prod";

    public String getLinkBase() { return linkBase; }
    public void setLinkBase(String linkBase) { this.linkBase = linkBase; }
    public int getLinkTtlHours() { return linkTtlHours; }
    public void setLinkTtlHours(int linkTtlHours) { this.linkTtlHours = linkTtlHours; }
    public int getMaxAccountDays() { return maxAccountDays; }
    public void setMaxAccountDays(int maxAccountDays) { this.maxAccountDays = maxAccountDays; }
    public String getTokenSecret() { return tokenSecret; }
    public void setTokenSecret(String tokenSecret) { this.tokenSecret = tokenSecret; }
}
