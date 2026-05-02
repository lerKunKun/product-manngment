package com.biou.shopifyhub.org.dingtalk;

import com.biou.shopifyhub.auth.dingtalk.DingTalkProperties;
import com.biou.shopifyhub.core.mq.RabbitMqConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * 钉钉事件订阅回调（替代 auth/dingtalk/DingTalkAuthController.event 的占位）。
 *
 * 钉钉调用：POST /auth/dingtalk/event?signature=&timestamp=&nonce= body={encrypt:""}
 *
 * 处理：
 *  1. 验签 → 防伪造
 *  2. 解密 → JSON
 *  3. 投 RabbitMQ exchange=shub.events routing=dingtalk.sync.{eventType}
 *  4. 返回加密的 success
 *
 * 未配置 EVENT_TOKEN/EVENT_AES_KEY 时返回 503，告诉钉钉本应用未启用事件订阅。
 */
@RestController
@RequestMapping("/auth/dingtalk")
public class DingTalkEventController {

    private static final Logger log = LoggerFactory.getLogger(DingTalkEventController.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final DingTalkProperties props;
    private final RabbitTemplate rabbit;

    public DingTalkEventController(DingTalkProperties props, RabbitTemplate rabbit) {
        this.props = props;
        this.rabbit = rabbit;
    }

    @PostMapping("/event-v2")
    public Map<String, String> event(
        @RequestParam String signature,
        @RequestParam String timestamp,
        @RequestParam String nonce,
        @RequestBody Map<String, String> body
    ) {
        if (props.getEventToken() == null || props.getEventToken().isBlank()
            || props.getEventAesKey() == null || props.getEventAesKey().isBlank()) {
            log.warn("DingTalk event 收到但 token/aesKey 未配置，丢弃");
            return Map.of("error", "event subscription not configured");
        }
        DingTalkEventCrypto crypto = new DingTalkEventCrypto(
            props.getEventToken(),
            props.getEventAesKey(),
            props.getMainCorpId()
        );

        String encrypted = body.get("encrypt");
        String expectedSig = crypto.sha1Sign(timestamp, nonce, encrypted);
        if (!expectedSig.equals(signature)) {
            log.warn("DingTalk event signature 不匹配 expected={} got={}", expectedSig, signature);
            return Map.of("error", "signature mismatch");
        }

        try {
            String plaintext = crypto.decrypt(encrypted);
            JsonNode n = JSON.readTree(plaintext);
            String eventType = n.path("EventType").asText("unknown");
            log.info("[dingtalk-event] type={} body={}", eventType, plaintext);

            // 投 RabbitMQ
            Map<String, Object> envelope = new HashMap<>();
            envelope.put("eventType", eventType);
            envelope.put("payload", plaintext);
            envelope.put("ts", System.currentTimeMillis());
            rabbit.convertAndSend(RabbitMqConfig.EXCHANGE, "dingtalk.sync." + eventType, envelope);

            // 返回钉钉要求的加密 success
            DingTalkEventCrypto.Encrypted enc = crypto.encrypt("success");
            Map<String, String> resp = new HashMap<>();
            resp.put("encrypt", enc.encrypt());
            resp.put("msg_signature", enc.msgSignature());
            resp.put("timeStamp", enc.timeStamp());
            resp.put("nonce", enc.nonce());
            return resp;
        } catch (Exception e) {
            log.error("[dingtalk-event] 处理失败", e);
            return Map.of("error", e.getMessage());
        }
    }
}
