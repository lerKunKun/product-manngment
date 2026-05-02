package com.biou.shopifyhub.core.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "jwt")
public class JwtProperties {
    /** PEM 格式 RSA 私钥（PKCS#8） */
    private String privateKey;
    /** PEM 格式 RSA 公钥 */
    private String publicKey;
    /** access token 有效期 */
    private Duration accessTtl = Duration.ofMinutes(30);
    /** refresh token 有效期 */
    private Duration refreshTtl = Duration.ofDays(7);
    /** issuer */
    private String issuer = "shopify-hub";

    public String getPrivateKey() { return privateKey; }
    public void setPrivateKey(String privateKey) { this.privateKey = privateKey; }
    public String getPublicKey() { return publicKey; }
    public void setPublicKey(String publicKey) { this.publicKey = publicKey; }
    public Duration getAccessTtl() { return accessTtl; }
    public void setAccessTtl(Duration accessTtl) { this.accessTtl = accessTtl; }
    public Duration getRefreshTtl() { return refreshTtl; }
    public void setRefreshTtl(Duration refreshTtl) { this.refreshTtl = refreshTtl; }
    public String getIssuer() { return issuer; }
    public void setIssuer(String issuer) { this.issuer = issuer; }
}
