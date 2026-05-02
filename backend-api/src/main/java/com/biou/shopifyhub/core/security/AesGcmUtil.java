package com.biou.shopifyhub.core.security;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-256-GCM 加解密。用于：
 * - Shopify token / 钉钉 secret / R2 secret 等凭证入库前加密
 * - 备份文件加密
 *
 * 输出格式：base64( iv(12B) || ciphertext || tag(16B) )
 */
public final class AesGcmUtil {

    private static final int IV_LEN = 12;
    private static final int TAG_LEN_BITS = 128;
    private static final SecureRandom RNG = new SecureRandom();

    private AesGcmUtil() {}

    public static String encrypt(String plaintext, String base64Key) {
        if (plaintext == null) return null;
        try {
            byte[] key = Base64.getDecoder().decode(base64Key);
            byte[] iv = new byte[IV_LEN];
            RNG.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            SecretKey sk = new SecretKeySpec(key, "AES");
            cipher.init(Cipher.ENCRYPT_MODE, sk, new GCMParameterSpec(TAG_LEN_BITS, iv));
            byte[] ct = cipher.doFinal(plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            ByteBuffer out = ByteBuffer.allocate(IV_LEN + ct.length);
            out.put(iv).put(ct);
            return Base64.getEncoder().encodeToString(out.array());
        } catch (Exception e) {
            throw new IllegalStateException("AES-GCM encrypt failed", e);
        }
    }

    public static String decrypt(String encoded, String base64Key) {
        if (encoded == null) return null;
        try {
            byte[] all = Base64.getDecoder().decode(encoded);
            byte[] iv = new byte[IV_LEN];
            System.arraycopy(all, 0, iv, 0, IV_LEN);
            byte[] ct = new byte[all.length - IV_LEN];
            System.arraycopy(all, IV_LEN, ct, 0, ct.length);
            byte[] key = Base64.getDecoder().decode(base64Key);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_LEN_BITS, iv));
            byte[] pt = cipher.doFinal(ct);
            return new String(pt, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("AES-GCM decrypt failed", e);
        }
    }

    /** 生成 32 字节随机密钥的 base64（用于 .env 初始化）。 */
    public static String generateKey() {
        byte[] key = new byte[32];
        RNG.nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    public static void main(String[] args) {
        System.out.println(generateKey());
    }
}
