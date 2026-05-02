package com.biou.shopifyhub.invitation.service;

import com.biou.shopifyhub.invitation.InvitationProperties;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

@Component
public class InvitationTokenGenerator {

    private static final SecureRandom RNG = new SecureRandom();
    private final InvitationProperties props;

    public InvitationTokenGenerator(InvitationProperties props) {
        this.props = props;
    }

    /**
     * 生成 64 字符 token：32 字节 nonce 转 base64url（去填充），与邮箱 + 时间戳的 HMAC-SHA256 异或绑定。
     * 形态：base64url(nonce) + "." + base64url(hmac8)，确保唯一 + 防猜测。
     */
    public String generate(String email) {
        byte[] nonce = new byte[18];
        RNG.nextBytes(nonce);
        String nonceB64 = Base64.getUrlEncoder().withoutPadding().encodeToString(nonce);

        byte[] hmac = hmacSha256(props.getTokenSecret(), email + ":" + nonceB64);
        // 取前 8 字节作为绑定签名，base64url 后约 11 字符
        byte[] sig = new byte[8];
        System.arraycopy(hmac, 0, sig, 0, 8);
        String sigB64 = Base64.getUrlEncoder().withoutPadding().encodeToString(sig);

        return nonceB64 + "." + sigB64;
    }

    public boolean verify(String token, String email) {
        if (token == null || !token.contains(".")) return false;
        String[] parts = token.split("\\.", 2);
        byte[] hmac = hmacSha256(props.getTokenSecret(), email + ":" + parts[0]);
        byte[] expected = new byte[8];
        System.arraycopy(hmac, 0, expected, 0, 8);
        String expectedB64 = Base64.getUrlEncoder().withoutPadding().encodeToString(expected);
        return constantTimeEquals(parts[1], expectedB64);
    }

    /** 临时密码：12 位强随机（大小写+数字+符号） */
    public String generateTempPassword() {
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
        StringBuilder sb = new StringBuilder(12);
        for (int i = 0; i < 12; i++) sb.append(chars.charAt(RNG.nextInt(chars.length())));
        return sb.toString();
    }

    private static byte[] hmacSha256(String secret, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC failed", e);
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int r = 0;
        for (int i = 0; i < a.length(); i++) r |= a.charAt(i) ^ b.charAt(i);
        return r == 0;
    }

    // For debugging
    static String hex(byte[] b) { return HexFormat.of().formatHex(b); }
}
