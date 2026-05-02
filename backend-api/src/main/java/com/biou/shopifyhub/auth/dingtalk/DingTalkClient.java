package com.biou.shopifyhub.auth.dingtalk;

import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * 钉钉 OAuth 2.0 + 通讯录 API 客户端。
 * 文档：https://open.dingtalk.com/document/orgapp/obtain-the-userid-of-a-user-by-using-the-log-on
 */
@Component
public class DingTalkClient {

    private static final Logger log = LoggerFactory.getLogger(DingTalkClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();

    private final DingTalkProperties props;

    @Value("${dingtalk.token-url:https://api.dingtalk.com/v1.0/oauth2/userAccessToken}")
    private String tokenUrl;

    @Value("${dingtalk.user-info-url:https://api.dingtalk.com/v1.0/contact/users/me}")
    private String userInfoUrl;

    public DingTalkClient(DingTalkProperties props) {
        this.props = props;
    }

    /** 用 authCode 换 user accessToken（OAuth2 v1.0）。 */
    public DingTalkAccessToken exchangeUserToken(String authCode) {
        require(props.isConfigured(), "钉钉未配置");
        try {
            String body = JSON.writeValueAsString(Map.of(
                "clientId", props.getMainAppKey(),
                "clientSecret", props.getMainAppSecret(),
                "code", authCode,
                "grantType", "authorization_code"
            ));
            HttpRequest req = HttpRequest.newBuilder(URI.create(tokenUrl))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(8))
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(resp.body());
            if (resp.statusCode() != 200 || n.get("accessToken") == null) {
                log.warn("DingTalk userAccessToken failed: status={} body={}", resp.statusCode(), resp.body());
                throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "钉钉换 token 失败");
            }
            return new DingTalkAccessToken(
                n.get("accessToken").asText(),
                n.has("refreshToken") ? n.get("refreshToken").asText() : null,
                n.has("expireIn") ? n.get("expireIn").asInt() : 7200
            );
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("DingTalk exchangeUserToken error", e);
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "钉钉接口异常: " + e.getMessage());
        }
    }

    /** 用 user accessToken 拿当前钉钉用户信息（v1.0 contact/users/me）。 */
    public DingTalkUser getMe(String userAccessToken) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(userInfoUrl))
                .header("x-acs-dingtalk-access-token", userAccessToken)
                .timeout(Duration.ofSeconds(8))
                .GET()
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(resp.body());
            if (resp.statusCode() != 200) {
                log.warn("DingTalk getMe failed: status={} body={}", resp.statusCode(), resp.body());
                throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "钉钉拉用户信息失败");
            }
            return new DingTalkUser(
                n.path("unionId").asText(null),
                n.path("openId").asText(null),
                n.path("nick").asText(null),
                n.path("avatarUrl").asText(null),
                n.path("mobile").asText(null),
                n.path("email").asText(null),
                n.path("stateCode").asText(null)
            );
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("DingTalk getMe error", e);
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "钉钉接口异常: " + e.getMessage());
        }
    }

    private static void require(boolean cond, String msg) {
        if (!cond) throw new BusinessException(ResultCode.DEPENDENCY_DOWN, msg);
    }

    public record DingTalkAccessToken(String accessToken, String refreshToken, int expiresInSec) {}
    public record DingTalkUser(String unionId, String openId, String nick, String avatarUrl,
                               String mobile, String email, String stateCode) {}
}
