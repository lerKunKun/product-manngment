package com.biou.shopifyhub.auth.dingtalk;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dingtalk")
public class DingTalkProperties {
    /** 主公司 corpId */
    private String mainCorpId;
    /** 主公司 agentId */
    private String mainAgentId;
    /** 主公司 app key */
    private String mainAppKey;
    /** 主公司 app secret（开发阶段明文，生产应入 dingtalk_corp 表 AES-GCM 加密存储） */
    private String mainAppSecret;
    /** 钉钉事件订阅签名 token */
    private String eventToken;
    /** 钉钉事件订阅 AES key */
    private String eventAesKey;

    public String getMainCorpId() { return mainCorpId; }
    public void setMainCorpId(String mainCorpId) { this.mainCorpId = mainCorpId; }
    public String getMainAgentId() { return mainAgentId; }
    public void setMainAgentId(String mainAgentId) { this.mainAgentId = mainAgentId; }
    public String getMainAppKey() { return mainAppKey; }
    public void setMainAppKey(String mainAppKey) { this.mainAppKey = mainAppKey; }
    public String getMainAppSecret() { return mainAppSecret; }
    public void setMainAppSecret(String mainAppSecret) { this.mainAppSecret = mainAppSecret; }
    public String getEventToken() { return eventToken; }
    public void setEventToken(String eventToken) { this.eventToken = eventToken; }
    public String getEventAesKey() { return eventAesKey; }
    public void setEventAesKey(String eventAesKey) { this.eventAesKey = eventAesKey; }

    public boolean isConfigured() {
        return mainCorpId != null && !mainCorpId.isBlank()
            && mainAppKey != null && !mainAppKey.isBlank()
            && mainAppSecret != null && !mainAppSecret.isBlank();
    }
}
