package com.biou.shopifyhub.auth.dingtalk;

import com.biou.shopifyhub.auth.dto.LoginResponse;
import com.biou.shopifyhub.auth.service.DingTalkLoginService;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * 钉钉扫码登录 Controller。
 *
 * 流程：
 *  1. 前端 → GET /auth/dingtalk/qrcode?tenant=hy
 *     后端返回构造好的钉钉 OAuth URL（前端打开新窗口跳转）
 *  2. 用户扫码同意 → 钉钉跳回 GET /auth/dingtalk/callback?authCode=&state=
 *     后端 verify state → exchange token → getMe → loginOrRegister → 302 跳前端 + JWT 在 query 上
 *
 * Wave 1 后期：用前端 SSE / postMessage 替换 query 上 JWT；当前简化便于联调。
 */
@RestController
@RequestMapping("/auth/dingtalk")
public class DingTalkAuthController {

    private static final Logger log = LoggerFactory.getLogger(DingTalkAuthController.class);

    private final DingTalkProperties props;
    private final DingTalkClient client;
    private final DingTalkStateService stateService;
    private final DingTalkLoginService loginService;

    @Value("${dingtalk.qr-connect-url:https://login.dingtalk.com/oauth2/auth}")
    private String qrConnectUrl;

    @Value("${dingtalk.redirect-uri:http://localhost:8080/api/auth/dingtalk/callback}")
    private String redirectUri;

    @Value("${dingtalk.frontend-redirect:http://localhost:3000}")
    private String frontendRedirect;

    public DingTalkAuthController(
        DingTalkProperties props,
        DingTalkClient client,
        DingTalkStateService stateService,
        DingTalkLoginService loginService
    ) {
        this.props = props;
        this.client = client;
        this.stateService = stateService;
        this.loginService = loginService;
    }

    @GetMapping("/qrcode")
    public Result<Map<String, String>> qrcode(@RequestParam(required = false) String tenant) {
        ensureConfigured();
        String state = stateService.issue(tenant);
        String url = qrConnectUrl
            + "?response_type=code"
            + "&client_id=" + enc(props.getMainAppKey())
            + "&scope=openid+corpid"
            + "&prompt=consent"
            + "&corpId=" + enc(props.getMainCorpId())
            + "&redirect_uri=" + enc(redirectUri)
            + "&state=" + enc(state);
        return Result.ok(Map.of("oauthUrl", url, "state", state));
    }

    @GetMapping("/callback")
    public void callback(
        @RequestParam(value = "authCode", required = false) String authCode,
        @RequestParam(value = "code", required = false) String codeAlias,
        @RequestParam String state,
        HttpServletResponse response
    ) throws IOException {
        ensureConfigured();
        DingTalkStateService.StateData std = stateService.verify(state);
        String code = authCode != null ? authCode : codeAlias;
        if (code == null || code.isBlank()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "callback 缺 authCode");
        }

        DingTalkClient.DingTalkAccessToken tok = client.exchangeUserToken(code);
        DingTalkClient.DingTalkUser dtUser = client.getMe(tok.accessToken());
        log.info("[dingtalk-callback] tenant={} unionId={} nick={}", std.tenantCode(), dtUser.unionId(), dtUser.nick());

        LoginResponse login = loginService.loginOrRegister(dtUser, std.tenantCode());

        // 跳前端，把 token 暂时放 query。生产改 postMessage / 一次性 ticket。
        String dest = frontendRedirect + "/login/dingtalk-success"
            + "?accessToken=" + enc(login.accessToken())
            + "&refreshToken=" + enc(login.refreshToken())
            + "&userId=" + login.userId()
            + "&username=" + enc(login.username())
            + "&pwdMustChange=" + login.passwordMustChange();
        response.sendRedirect(dest);
    }

    @PostMapping("/event")
    public Map<String, String> event(
        @RequestHeader Map<String, String> headers,
        @RequestBody String rawBody
    ) {
        ensureConfigured();
        // TODO W1-ORG-02: HMAC 验签 → 投 RabbitMQ dingtalk.sync 队列
        log.info("[dingtalk-event] received body bytes={} headers.timestamp={}", rawBody.length(), headers.get("timestamp"));
        return Map.of("msg_signature", "TODO", "note", "W1-ORG-02 not implemented");
    }

    private void ensureConfigured() {
        if (!props.isConfigured()) {
            throw new BusinessException(
                ResultCode.DEPENDENCY_DOWN,
                "钉钉企业内部应用未配置（DINGTALK_MAIN_*），见《配置指南.md》§3"
            );
        }
    }

    private static String enc(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }
}
