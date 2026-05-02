package com.biou.shopifyhub.webhook;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

/**
 * Shopify webhook HMAC-SHA256 verifier.
 *
 * <p>Computes HMAC-SHA256 over raw request body bytes using the configured
 * shared secret, base64-encodes it, and constant-time compares to the
 * {@code X-Shopify-Hmac-Sha256} header.
 *
 * <p>Dev convenience: when {@code shopify.webhook.secret} is empty / blank,
 * verification is skipped (returns {@code true}) and a WARN is logged once
 * per call so dev can iterate without pretending to know Partner App secret.
 * Production must configure the secret.
 */
@Component
public class ShopifyHmacVerifier {

    private static final Logger log = LoggerFactory.getLogger(ShopifyHmacVerifier.class);
    private static final String HMAC_ALGO = "HmacSHA256";

    @Value("${shopify.webhook.secret:}")
    private String secret;

    public boolean isConfigured() {
        return secret != null && !secret.isBlank();
    }

    /**
     * @param body raw HTTP body bytes (NOT a re-serialized JSON string)
     * @param headerHmac value of X-Shopify-Hmac-Sha256 header (base64), may be null
     * @return true if HMAC matches, OR secret is not configured (skipped path);
     *         false if secret is configured AND header missing / mismatch.
     */
    public boolean verify(byte[] body, String headerHmac) {
        if (!isConfigured()) {
            log.warn("[shopify-hmac] SHOPIFY_WEBHOOK_SECRET not configured — HMAC verification SKIPPED (dev only)");
            return true;
        }
        if (headerHmac == null || headerHmac.isBlank()) {
            log.warn("[shopify-hmac] missing X-Shopify-Hmac-Sha256 header");
            return false;
        }
        try {
            Mac mac = Mac.getInstance(HMAC_ALGO);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_ALGO));
            byte[] digest = mac.doFinal(body == null ? new byte[0] : body);
            String expected = Base64.getEncoder().encodeToString(digest);
            // constant-time compare on bytes of base64 (both should be UTF-8 ASCII)
            byte[] a = expected.getBytes(StandardCharsets.UTF_8);
            byte[] b = headerHmac.trim().getBytes(StandardCharsets.UTF_8);
            return MessageDigest.isEqual(a, b);
        } catch (Exception e) {
            log.error("[shopify-hmac] HMAC compute failure: {}", e.getMessage(), e);
            return false;
        }
    }
}
