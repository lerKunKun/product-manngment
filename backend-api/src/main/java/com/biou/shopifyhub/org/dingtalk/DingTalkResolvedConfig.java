package com.biou.shopifyhub.org.dingtalk;

/**
 * 解析后的钉钉配置（按 org/tenant 解析；secret 已解密）。
 * source 用于追踪：DB / ENV，方便排错时区分。
 *
 * 注意：不要把这个对象 toString / 入日志，secret 是明文。
 */
public record DingTalkResolvedConfig(
    Long orgId,           // 命中 DB 时为 sys_org.id；env fallback 时为 null
    String corpId,
    String agentId,
    String appKey,
    String appSecret,     // 明文（已解密）
    String eventToken,    // 可选
    String eventAesKey,   // 可选
    Source source
) {
    public enum Source { DB, ENV }

    public boolean isConfigured() {
        return corpId != null && !corpId.isBlank()
            && appKey != null && !appKey.isBlank()
            && appSecret != null && !appSecret.isBlank();
    }

    @Override
    public String toString() {
        // 故意不输出 secret
        return "DingTalkResolvedConfig{orgId=" + orgId
            + ", corpId=" + corpId
            + ", appKey=" + appKey
            + ", agentId=" + agentId
            + ", source=" + source + "}";
    }
}
