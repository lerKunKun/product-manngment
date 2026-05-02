package com.biou.shopifyhub.core.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

@Component
public class JwtUtil implements InitializingBean {

    private final JwtProperties props;
    private PrivateKey privateKey;
    private PublicKey publicKey;

    public JwtUtil(JwtProperties props) {
        this.props = props;
    }

    @Override
    public void afterPropertiesSet() throws Exception {
        if (props.getPrivateKey() != null && !props.getPrivateKey().isBlank()) {
            this.privateKey = parsePrivateKey(props.getPrivateKey());
        }
        if (props.getPublicKey() != null && !props.getPublicKey().isBlank()) {
            this.publicKey = parsePublicKey(props.getPublicKey());
        }
        // dev 阶段允许双 null：JWT 功能不可用但应用能起来
    }

    public String issueAccess(long userId, String username, Map<String, Object> claims) {
        require(privateKey, "JWT_PRIVATE_KEY 未配置");
        Instant now = Instant.now();
        return Jwts.builder()
            .issuer(props.getIssuer())
            .subject(String.valueOf(userId))
            .claim("uname", username)
            .claim("typ", "access")
            .claims(claims)
            .issuedAt(java.util.Date.from(now))
            .expiration(java.util.Date.from(now.plus(props.getAccessTtl())))
            .signWith(privateKey, Jwts.SIG.RS256)
            .compact();
    }

    public String issueRefresh(long userId, String username) {
        require(privateKey, "JWT_PRIVATE_KEY 未配置");
        Instant now = Instant.now();
        return Jwts.builder()
            .issuer(props.getIssuer())
            .subject(String.valueOf(userId))
            .claim("uname", username)
            .claim("typ", "refresh")
            .issuedAt(java.util.Date.from(now))
            .expiration(java.util.Date.from(now.plus(props.getRefreshTtl())))
            .signWith(privateKey, Jwts.SIG.RS256)
            .compact();
    }

    public Claims parse(String token) {
        require(publicKey, "JWT_PUBLIC_KEY 未配置");
        return Jwts.parser().verifyWith(publicKey).build().parseSignedClaims(token).getPayload();
    }

    private static void require(Object o, String msg) {
        if (o == null) throw new IllegalStateException(msg);
    }

    private static PrivateKey parsePrivateKey(String pem) throws Exception {
        String body = pem.replaceAll("-----BEGIN [A-Z ]+-----", "")
            .replaceAll("-----END [A-Z ]+-----", "")
            .replaceAll("\\s", "");
        byte[] bytes = Base64.getDecoder().decode(body);
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(bytes));
    }

    private static PublicKey parsePublicKey(String pem) throws Exception {
        String body = pem.replaceAll("-----BEGIN [A-Z ]+-----", "")
            .replaceAll("-----END [A-Z ]+-----", "")
            .replaceAll("\\s", "");
        byte[] bytes = Base64.getDecoder().decode(body);
        return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(bytes));
    }
}
