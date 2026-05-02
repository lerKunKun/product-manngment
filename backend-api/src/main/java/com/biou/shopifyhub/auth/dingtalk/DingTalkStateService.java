package com.biou.shopifyhub.auth.dingtalk;

import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.invitation.InvitationProperties;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 钉钉扫码 OAuth 的 state 参数生成与校验。
 * state = base64url(nonce(18) + tenant.bytes + ":" + ts)+ "." + base64url(hmac8)
 * 复用邀请的 token secret 做 HMAC（也可单独配置）。
 */
@Component
public class DingTalkStateService {

    private static final SecureRandom RNG = new SecureRandom();
    private static final long MAX_AGE_MS = 10 * 60 * 1000L;

    private final InvitationProperties props;

    public DingTalkStateService(InvitationProperties props) {
        this.props = props;
    }

    public String issue(String tenantCode) {
        long ts = System.currentTimeMillis();
        byte[] nonce = new byte[12];
        RNG.nextBytes(nonce);
        String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(nonce)
            + "|" + (tenantCode == null ? "" : tenantCode)
            + "|" + ts;
        String sig = sign(payload);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8))
            + "." + sig;
    }

    public StateData verify(String state) {
        if (state == null || !state.contains(".")) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "state 格式错");
        }
        String[] parts = state.split("\\.", 2);
        String payload;
        try {
            payload = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "state 解码失败");
        }
        if (!constantTimeEquals(parts[1], sign(payload))) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "state 签名不匹配");
        }
        String[] segs = payload.split("\\|", 3);
        if (segs.length != 3) throw new BusinessException(ResultCode.BAD_REQUEST, "state 缺字段");
        long ts;
        try { ts = Long.parseLong(segs[2]); }
        catch (NumberFormatException e) { throw new BusinessException(ResultCode.BAD_REQUEST, "state ts 错"); }
        if (System.currentTimeMillis() - ts > MAX_AGE_MS) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "state 已过期，请重新扫码");
        }
        return new StateData(segs[1].isEmpty() ? null : segs[1], ts);
    }

    private String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(props.getTokenSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] full = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            byte[] eight = new byte[8];
            System.arraycopy(full, 0, eight, 0, 8);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(eight);
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

    public record StateData(String tenantCode, long issuedAt) {}
}
