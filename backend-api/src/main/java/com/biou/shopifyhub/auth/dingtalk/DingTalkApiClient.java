package com.biou.shopifyhub.auth.dingtalk;

import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * 钉钉服务端 API 客户端：
 *  - 拿 access_token（7000s 缓存于 Redis；过期前 100s 刷新）
 *  - 发送工作通知（asyncsend_v2）
 *
 * 文档：
 *  - https://open.dingtalk.com/document/orgapp/obtain-orgapp-token
 *  - https://open.dingtalk.com/document/orgapp/asynchronous-sending-of-enterprise-session-messages
 */
@Component
public class DingTalkApiClient {

    private static final Logger log = LoggerFactory.getLogger(DingTalkApiClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String GET_TOKEN_URL =
        "https://oapi.dingtalk.com/gettoken?appkey=%s&appsecret=%s";
    private static final String ASYNC_SEND_URL =
        "https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=%s";
    private static final String CACHE_KEY = "dingtalk:access_token:";

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();
    private final DingTalkProperties props;
    private final StringRedisTemplate redis;

    public DingTalkApiClient(DingTalkProperties props, StringRedisTemplate redis) {
        this.props = props;
        this.redis = redis;
    }

    /**
     * 取主公司 access_token（带 Redis 缓存，6900s 过期）。
     */
    public String getAccessToken() {
        if (!props.isConfigured()) {
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "钉钉未配置");
        }
        String key = CACHE_KEY + props.getMainAppKey();
        String cached = redis.opsForValue().get(key);
        if (cached != null && !cached.isBlank()) return cached;

        try {
            String url = String.format(GET_TOKEN_URL, props.getMainAppKey(), props.getMainAppSecret());
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .GET()
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(resp.body());
            int errcode = n.path("errcode").asInt(-1);
            String token = n.path("access_token").asText(null);
            if (errcode != 0 || token == null) {
                log.warn("DingTalk gettoken failed: {}", resp.body());
                throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "拿钉钉 access_token 失败: " + resp.body());
            }
            redis.opsForValue().set(key, token, Duration.ofSeconds(6900));
            return token;
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("DingTalk gettoken error", e);
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "钉钉接口异常: " + e.getMessage());
        }
    }

    /**
     * 发送工作通知（OA 文本消息）。targetUserIds = 钉钉 userId 列表（不是 unionId）。
     */
    public boolean sendTextWorkNotification(java.util.List<String> targetUserIds, String text) {
        if (targetUserIds == null || targetUserIds.isEmpty()) return false;
        try {
            String token = getAccessToken();
            Map<String, Object> body = Map.of(
                "agent_id", Long.parseLong(props.getMainAgentId()),
                "userid_list", String.join(",", targetUserIds),
                "msg", Map.of("msgtype", "text", "text", Map.of("content", text))
            );
            String json = JSON.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder(URI.create(String.format(ASYNC_SEND_URL, token)))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(8))
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(resp.body());
            int errcode = n.path("errcode").asInt(-1);
            if (errcode != 0) {
                log.warn("DingTalk asyncsend_v2 failed: {}", resp.body());
                return false;
            }
            log.info("DingTalk msg sent task_id={} to={}", n.path("task_id").asText(), targetUserIds);
            return true;
        } catch (Exception e) {
            log.error("DingTalk asyncsend error", e);
            return false;
        }
    }

    /**
     * 发文本通知给单个用户（按 sys_user.dingtalk_userid，没有则跳过）。
     */
    public boolean sendTextToUser(String dingtalkUserId, String text) {
        if (dingtalkUserId == null || dingtalkUserId.isBlank()) {
            log.debug("[dingtalk-skip] user has no dingtalkUserId, falling back to log: {}", text);
            return false;
        }
        return sendTextWorkNotification(java.util.List.of(dingtalkUserId), text);
    }

    // ============================================
    // W4-NTF-03 多 corpId 支持
    // 调用方需提供 (corpId, agentId, appKey, appSecret) —— 来自 dingtalk_corp 表，
    // app_secret 已 AES 解密。这里只负责拿 token + 发消息，不读 DB。
    // ============================================

    /**
     * 拿指定 corp 的 access_token（按 corpId+appKey 维度独立缓存）。
     */
    public String getAccessTokenForCorp(String corpId, String appKey, String appSecret) {
        if (corpId == null || corpId.isBlank() || appKey == null || appKey.isBlank()
            || appSecret == null || appSecret.isBlank()) {
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "钉钉 corp 配置不完整: " + corpId);
        }
        String key = CACHE_KEY + corpId + ":" + appKey;
        String cached = redis.opsForValue().get(key);
        if (cached != null && !cached.isBlank()) return cached;

        try {
            String url = String.format(GET_TOKEN_URL, appKey, appSecret);
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .GET()
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(resp.body());
            int errcode = n.path("errcode").asInt(-1);
            String token = n.path("access_token").asText(null);
            if (errcode != 0 || token == null) {
                log.warn("DingTalk gettoken failed for corp={}: {}", corpId, resp.body());
                throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "拿钉钉 access_token 失败 corp=" + corpId);
            }
            redis.opsForValue().set(key, token, Duration.ofSeconds(6900));
            return token;
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("DingTalk gettoken error corp={}", corpId, e);
            throw new BusinessException(ResultCode.DEPENDENCY_DOWN, "钉钉接口异常: " + e.getMessage());
        }
    }

    /**
     * 通过 unionId 反查该 corp 下的 userId。
     * 文档：https://open.dingtalk.com/document/orgapp/query-a-user-by-the-union-id
     * 命中返回 userid，未命中或 errcode=60121（用户不在该企业）返回 null。
     */
    public String getUserIdByUnionId(String accessToken, String unionId) {
        if (accessToken == null || accessToken.isBlank() || unionId == null || unionId.isBlank()) {
            return null;
        }
        try {
            String url = "https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=" + accessToken;
            String json = JSON.writeValueAsString(Map.of("unionid", unionId));
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(8))
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(resp.body());
            int errcode = n.path("errcode").asInt(-1);
            if (errcode == 0) {
                return n.path("result").path("userid").asText(null);
            }
            // 60121: 该 unionId 不在此企业 — 不算硬错误
            log.warn("DingTalk getbyunionid not-found errcode={} body={}", errcode, resp.body());
            return null;
        } catch (Exception e) {
            log.error("DingTalk getbyunionid error unionId={}", unionId, e);
            return null;
        }
    }

    /**
     * 用指定 corp 的 token + agent 发工作通知。userIds = 该 corp 下的钉钉 userId。
     */
    public boolean sendTextWorkNotificationForCorp(String corpId, String agentId, String appKey,
                                                   String appSecret, java.util.List<String> targetUserIds, String text) {
        if (targetUserIds == null || targetUserIds.isEmpty()) return false;
        if (agentId == null || agentId.isBlank()) {
            log.warn("[dingtalk-skip] corp={} no agentId, fallback to log", corpId);
            return false;
        }
        try {
            String token = getAccessTokenForCorp(corpId, appKey, appSecret);
            Map<String, Object> body = Map.of(
                "agent_id", Long.parseLong(agentId),
                "userid_list", String.join(",", targetUserIds),
                "msg", Map.of("msgtype", "text", "text", Map.of("content", text))
            );
            String json = JSON.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder(URI.create(String.format(ASYNC_SEND_URL, token)))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(8))
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(resp.body());
            int errcode = n.path("errcode").asInt(-1);
            if (errcode != 0) {
                log.warn("DingTalk asyncsend_v2 failed corp={}: {}", corpId, resp.body());
                return false;
            }
            log.info("DingTalk msg sent corp={} task_id={} to={}", corpId, n.path("task_id").asText(), targetUserIds);
            return true;
        } catch (Exception e) {
            log.error("DingTalk asyncsend error corp={}", corpId, e);
            return false;
        }
    }
}
