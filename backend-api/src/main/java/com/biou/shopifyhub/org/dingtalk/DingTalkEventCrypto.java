package com.biou.shopifyhub.org.dingtalk;

import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.ResultCode;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

/**
 * 钉钉事件订阅回调的加解密工具。
 * 协议见：https://open.dingtalk.com/document/orgapp/configure-event-subcription
 *
 * 关键流程：
 *  - encodingAesKey 是 43 位 base64-like 字符串（钉钉应用页配置时让用户填）
 *  - aes_key = base64Decode(encodingAesKey + "=")，长度 32 字节
 *  - 加密 payload = AES-CBC（PKCS7 padding）：[16B random] + [4B msg_len BE] + msg.bytes + corpId.bytes
 *  - 签名 = sha1( token + timestamp + nonce + encrypted ) → 40 字符 hex
 *
 * 此类不依赖第三方钉钉 SDK（避免 jar 依赖膨胀），直接按协议实现。
 */
public final class DingTalkEventCrypto {

    private final byte[] aesKey;
    private final String token;
    private final String corpId;

    public DingTalkEventCrypto(String token, String encodingAesKey, String corpId) {
        if (encodingAesKey == null || encodingAesKey.length() != 43) {
            throw new IllegalArgumentException("encodingAesKey 长度必须 43");
        }
        this.token = token;
        this.corpId = corpId;
        this.aesKey = Base64.getDecoder().decode(encodingAesKey + "=");
    }

    /** 计算签名（钉钉 callback 须验证 signature == sha1Hex(sort([token,timestamp,nonce,encrypted])) ）。 */
    public String sha1Sign(String timestamp, String nonce, String encrypted) {
        try {
            List<String> parts = Arrays.asList(token, timestamp, nonce, encrypted);
            List<String> sorted = new java.util.ArrayList<>(parts);
            java.util.Collections.sort(sorted);
            String joined = String.join("", sorted);
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] hash = md.digest(joined.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("sha1 fail", e);
        }
    }

    public String decrypt(String encrypted) {
        try {
            byte[] ct = Base64.getDecoder().decode(encrypted);
            Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"),
                new IvParameterSpec(aesKey, 0, 16));
            byte[] plain = cipher.doFinal(ct);
            byte[] unpadded = pkcs7Unpad(plain);
            // 去掉前 16 字节 random
            byte[] withoutRandom = Arrays.copyOfRange(unpadded, 16, unpadded.length);
            // 4 字节 BE msg length
            int msgLen = ((withoutRandom[0] & 0xff) << 24)
                       | ((withoutRandom[1] & 0xff) << 16)
                       | ((withoutRandom[2] & 0xff) << 8)
                       |  (withoutRandom[3] & 0xff);
            byte[] msgBytes = Arrays.copyOfRange(withoutRandom, 4, 4 + msgLen);
            byte[] corpBytes = Arrays.copyOfRange(withoutRandom, 4 + msgLen, withoutRandom.length);
            String corp = new String(corpBytes, StandardCharsets.UTF_8);
            if (!corp.equals(corpId)) {
                throw new BusinessException(ResultCode.FORBIDDEN, "corpId 不匹配: " + corp);
            }
            return new String(msgBytes, StandardCharsets.UTF_8);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "解密失败: " + e.getMessage());
        }
    }

    /** 加密响应（钉钉要求回调成功后返回 success 加密包）。 */
    public Encrypted encrypt(String plaintext) {
        try {
            byte[] randomPrefix = randomBytes(16);
            byte[] msg = plaintext.getBytes(StandardCharsets.UTF_8);
            byte[] msgLen = new byte[]{
                (byte) ((msg.length >> 24) & 0xff),
                (byte) ((msg.length >> 16) & 0xff),
                (byte) ((msg.length >> 8) & 0xff),
                (byte) (msg.length & 0xff),
            };
            byte[] corpBytes = corpId.getBytes(StandardCharsets.UTF_8);
            byte[] full = new byte[randomPrefix.length + msgLen.length + msg.length + corpBytes.length];
            int pos = 0;
            System.arraycopy(randomPrefix, 0, full, pos, randomPrefix.length); pos += randomPrefix.length;
            System.arraycopy(msgLen, 0, full, pos, msgLen.length); pos += msgLen.length;
            System.arraycopy(msg, 0, full, pos, msg.length); pos += msg.length;
            System.arraycopy(corpBytes, 0, full, pos, corpBytes.length);

            byte[] padded = pkcs7Pad(full, 32);
            Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(aesKey, "AES"),
                new IvParameterSpec(aesKey, 0, 16));
            byte[] ct = cipher.doFinal(padded);
            String encoded = Base64.getEncoder().encodeToString(ct);
            String ts = String.valueOf(System.currentTimeMillis() / 1000);
            String nonce = randomNonce();
            String sig = sha1Sign(ts, nonce, encoded);
            return new Encrypted(encoded, sig, ts, nonce);
        } catch (Exception e) {
            throw new IllegalStateException("encrypt fail", e);
        }
    }

    private static byte[] pkcs7Pad(byte[] in, int blockSize) {
        int pad = blockSize - in.length % blockSize;
        if (pad == 0) pad = blockSize;
        byte[] out = new byte[in.length + pad];
        System.arraycopy(in, 0, out, 0, in.length);
        for (int i = in.length; i < out.length; i++) out[i] = (byte) pad;
        return out;
    }

    private static byte[] pkcs7Unpad(byte[] in) {
        int pad = in[in.length - 1];
        if (pad < 1 || pad > 32) pad = 0;
        return Arrays.copyOf(in, in.length - pad);
    }

    private static byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        new java.security.SecureRandom().nextBytes(b);
        return b;
    }

    private static String randomNonce() {
        byte[] b = randomBytes(8);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    public record Encrypted(String encrypt, String msgSignature, String timeStamp, String nonce) {}
}
