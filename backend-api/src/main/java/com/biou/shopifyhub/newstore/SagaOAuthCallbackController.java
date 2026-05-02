package com.biou.shopifyhub.newstore;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * W3-NEW-02: Shopify OAuth 回调（saga 路径）。
 *
 * 与 W1-STORE-02 的 {@code /oauth/callback}（store-add 流程）独立 —— 该路径专为
 * 一键开店 saga 设计，state 携带 saga taskId（见 {@link SagaAuthService#signState}）。
 * 成功后 302 跳前端 wizard 页（默认 {@code /newstore/{taskId}}），失败跳错误页。
 */
@RestController
@RequestMapping("/oauth")
public class SagaOAuthCallbackController {

    private static final Logger log = LoggerFactory.getLogger(SagaOAuthCallbackController.class);

    private final SagaAuthService sagaAuthService;

    @Value("${shopify.oauth.saga-frontend-base:http://localhost:3000/newstore}")
    private String sagaFrontendBase;

    public SagaOAuthCallbackController(SagaAuthService sagaAuthService) {
        this.sagaAuthService = sagaAuthService;
    }

    @GetMapping("/saga-callback")
    public ResponseEntity<Void> callback(@RequestParam String code,
                                         @RequestParam String shop,
                                         @RequestParam String state,
                                         @RequestParam(required = false) String hmac) {
        try {
            Map<String, Object> r = sagaAuthService.handleCallback(code, shop, state, hmac);
            String redirect = sagaFrontendBase + "/" + r.get("taskId");
            return ResponseEntity.status(302).header("Location", redirect).build();
        } catch (Exception e) {
            log.warn("[saga-oauth] callback failed shop={} err={}", shop, e.getMessage());
            String redirect = sagaFrontendBase + "/error?msg="
                + URLEncoder.encode(e.getMessage() == null ? "unknown" : e.getMessage(), StandardCharsets.UTF_8);
            return ResponseEntity.status(302).header("Location", redirect).build();
        }
    }
}
