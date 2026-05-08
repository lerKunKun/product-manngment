package com.biou.shopifyhub.auth.dingtalk;

import com.biou.shopifyhub.auth.dto.LoginResult;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.auth.service.DingTalkLoginService;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.security.CookieUtil;
import com.biou.shopifyhub.core.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
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
    private final DingTalkBindService bindService;
    private final SysUserMapper userMapper;
    private final CookieUtil cookieUtil;

    @Value("${dingtalk.qr-connect-url}")
    private String qrConnectUrl;

    @Value("${dingtalk.redirect-uri}")
    private String redirectUri;

    @Value("${dingtalk.bind-redirect-uri}")
    private String bindRedirectUri;

    @Value("${dingtalk.frontend-redirect}")
    private String frontendRedirect;

    public DingTalkAuthController(
        DingTalkProperties props,
        DingTalkClient client,
        DingTalkStateService stateService,
        DingTalkLoginService loginService,
        DingTalkBindService bindService,
        SysUserMapper userMapper,
        CookieUtil cookieUtil
    ) {
        this.props = props;
        this.client = client;
        this.stateService = stateService;
        this.loginService = loginService;
        this.bindService = bindService;
        this.userMapper = userMapper;
        this.cookieUtil = cookieUtil;
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
        HttpServletRequest request,
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

        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isBlank()) ip = request.getRemoteAddr();
        else ip = ip.split(",")[0].trim();
        String ua = request.getHeader("User-Agent");

        LoginResult result = loginService.loginOrRegister(dtUser, std.tenantCode(), ip, ua);
        // refresh 进 httpOnly cookie；access 也不再放 URL — 前端进 success 页后调 /auth/refresh 凭 cookie 拿新 access
        cookieUtil.writeRefresh(response, result.refreshToken());
        response.sendRedirect(frontendRedirect + "/login/dingtalk-success");
    }

    // ==========================================================================
    // 个人中心「绑定钉钉」专用流程（与上面登录流程隔离）
    // 关键差异：bindCallback **不**走 loginOrRegister；只把 dingtalk_* 字段
    //          写入当前已登录用户。state 中携带 currentUserId，回调凭 state 识别。
    // 安全：/bind/qrcode 必须已登录；/bind/callback 走 permitAll 但靠 state HMAC 防伪。
    // ==========================================================================

    @GetMapping("/bind/qrcode")
    public Result<Map<String, String>> bindQrcode() {
        ensureConfigured();
        Long userId = CurrentUser.userIdOrThrow();
        Long tenantId = TenantContext.tenantId();
        String state = bindService.issueBindState(userId, tenantId);
        String url = qrConnectUrl
            + "?response_type=code"
            + "&client_id=" + enc(props.getMainAppKey())
            + "&scope=openid+corpid"
            + "&prompt=consent"
            + "&corpId=" + enc(props.getMainCorpId())
            + "&redirect_uri=" + enc(bindRedirectUri)
            + "&state=" + enc(state);
        return Result.ok(Map.of("oauthUrl", url, "state", state));
    }

    @GetMapping("/bind/callback")
    public void bindCallback(
        @RequestParam(value = "authCode", required = false) String authCode,
        @RequestParam(value = "code", required = false) String codeAlias,
        @RequestParam String state,
        HttpServletRequest request,
        HttpServletResponse response
    ) throws IOException {
        try {
            ensureConfigured();
            DingTalkStateService.BindStateData std = stateService.verifyBind(state);
            String code = authCode != null ? authCode : codeAlias;
            if (code == null || code.isBlank()) {
                throw new BusinessException(ResultCode.BAD_REQUEST, "callback 缺 authCode");
            }

            DingTalkClient.DingTalkAccessToken tok = client.exchangeUserToken(code);
            DingTalkClient.DingTalkUser dtUser = client.getMe(tok.accessToken());
            log.info("[dingtalk-bind-callback] userId={} unionId={} nick={}",
                std.userId(), dtUser.unionId(), dtUser.nick());

            String ip = request.getHeader("X-Forwarded-For");
            if (ip == null || ip.isBlank()) ip = request.getRemoteAddr();
            else ip = ip.split(",")[0].trim();
            String ua = request.getHeader("User-Agent");

            // 解出 dingUserId/corpId（非致命：失败也允许只写 unionId）
            SysUser current = userMapper.selectById(std.userId());
            if (current == null) {
                throw new BusinessException(ResultCode.NOT_FOUND, "当前用户不存在");
            }
            DingTalkBindService.ResolvedDingUser resolved =
                bindService.tryResolveDingUser(current, dtUser.unionId());

            bindService.bind(std.userId(), dtUser.unionId(),
                resolved.dingUserId(), resolved.corpId(), ip, ua);

            response.sendRedirect(frontendRedirect + "/profile?bound=1");
        } catch (BusinessException be) {
            log.warn("[dingtalk-bind-callback] failed code={} msg={}", be.code().code(), be.getMessage());
            String msg = be.detail() != null && !be.detail().isBlank() ? be.detail() : be.code().message();
            response.sendRedirect(frontendRedirect + "/profile?error=" + enc(msg));
        } catch (Exception e) {
            log.error("[dingtalk-bind-callback] unexpected error", e);
            response.sendRedirect(frontendRedirect + "/profile?error=" + enc("bind_failed"));
        }
    }

    /**
     * 解绑钉钉 + 设置新密码。要求当前已登录 + step-up（钉钉验证码二次确认）+ 新密码 ≥ 8 位。
     * 不校验旧密码：用户可能完全没用过本地密码（钉钉扫码登录），强制设置一遍才能保证解绑后还能登录。
     */
    @PostMapping("/unbind")
    @RequireSensitiveOp("DINGTALK_UNBIND")
    public Result<Void> unbind(@RequestBody UnbindReq req, HttpServletRequest request) {
        Long userId = CurrentUser.userIdOrThrow();
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isBlank()) ip = request.getRemoteAddr();
        else ip = ip.split(",")[0].trim();
        String ua = request.getHeader("User-Agent");
        bindService.unbind(userId, req == null ? null : req.newPassword, ip, ua);
        return Result.ok();
    }

    /** 解绑请求体：仅 newPassword（旧密码不校验，因为钉钉登录用户可能根本没用过本地密码）。 */
    public static class UnbindReq {
        public String newPassword;
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
