package com.biou.shopifyhub.core.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 登录会话（每个 sid = 一台在线设备）。
 *
 * Redis key: auth:session:{userId}:{sid} → JSON {ua, ip, label, loginAt, lastSeenAt}
 * TTL = jwt.refresh-ttl（与 refresh token 同寿命；过期即视为登出）
 *
 * - 登录：newSid + create()
 * - 每次受保护请求：JwtAuthFilter 调 exists() 验证；不存在 → 401（踢人立即生效）
 * - 心跳/refresh：touch() 续命 lastSeenAt
 * - 踢人：removeOthers(uid, currentSid) / remove(uid, sid)
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);
    private static final String KEY_PREFIX = "auth:session:";

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final Duration ttl;

    public SessionService(StringRedisTemplate redis,
                          ObjectMapper mapper,
                          @Value("${jwt.refresh-ttl:7d}") Duration ttl) {
        this.redis = redis;
        this.mapper = mapper;
        this.ttl = ttl;
    }

    public String newSid() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    public SessionInfo create(long userId, String sid, String userAgent, String ip) {
        long now = Instant.now().toEpochMilli();
        SessionInfo info = new SessionInfo(sid, parseLabel(userAgent), userAgent, ip, now, now);
        write(userId, sid, info);
        return info;
    }

    public boolean exists(long userId, String sid) {
        if (sid == null || sid.isBlank()) return false;
        return Boolean.TRUE.equals(redis.hasKey(key(userId, sid)));
    }

    /** 读取一条 session；不存在或反序列化失败返回 null。 */
    public SessionInfo get(long userId, String sid) {
        String json = redis.opsForValue().get(key(userId, sid));
        if (json == null) return null;
        try {
            return mapper.readValue(json, SessionInfo.class);
        } catch (JsonProcessingException e) {
            log.warn("session deserialize failed uid={} sid={}: {}", userId, sid, e.getMessage());
            return null;
        }
    }

    /** 续命 lastSeenAt + 重设 TTL。失败仅 log，不抛。 */
    public void touch(long userId, String sid) {
        SessionInfo info = get(userId, sid);
        if (info == null) return;
        SessionInfo updated = new SessionInfo(
            info.sid(), info.label(), info.userAgent(), info.ip(),
            info.loginAt(), Instant.now().toEpochMilli()
        );
        write(userId, sid, updated);
    }

    public List<SessionInfo> list(long userId) {
        Set<String> keys = redis.keys(KEY_PREFIX + userId + ":*");
        if (keys == null || keys.isEmpty()) return List.of();
        List<SessionInfo> out = new ArrayList<>(keys.size());
        for (String k : keys) {
            String json = redis.opsForValue().get(k);
            if (json == null) continue;
            try {
                out.add(mapper.readValue(json, SessionInfo.class));
            } catch (JsonProcessingException e) {
                log.warn("session deserialize failed key={}: {}", k, e.getMessage());
            }
        }
        out.sort((a, b) -> Long.compare(b.lastSeenAt(), a.lastSeenAt()));
        return out;
    }

    public void remove(long userId, String sid) {
        if (sid == null || sid.isBlank()) return;
        redis.delete(key(userId, sid));
    }

    /** 删除该用户除 keepSid 之外的全部 session。返回被踢条数。 */
    public long removeOthers(long userId, String keepSid) {
        Set<String> keys = redis.keys(KEY_PREFIX + userId + ":*");
        if (keys == null || keys.isEmpty()) return 0L;
        String keep = keepSid == null ? "" : key(userId, keepSid);
        List<String> toDel = new ArrayList<>(keys.size());
        for (String k : keys) if (!k.equals(keep)) toDel.add(k);
        if (toDel.isEmpty()) return 0L;
        Long n = redis.delete(toDel);
        return n == null ? 0L : n;
    }

    private void write(long userId, String sid, SessionInfo info) {
        try {
            redis.opsForValue().set(key(userId, sid), mapper.writeValueAsString(info), ttl);
        } catch (JsonProcessingException e) {
            log.error("session serialize failed uid={} sid={}: {}", userId, sid, e.getMessage());
        }
    }

    private static String key(long userId, String sid) {
        return KEY_PREFIX + userId + ":" + sid;
    }

    /** 极简 UA → 设备标签。够用即可，不引入 ua-parser 依赖。 */
    static String parseLabel(String ua) {
        if (ua == null || ua.isBlank()) return "未知设备";
        String s = ua.toLowerCase();
        String os;
        if (s.contains("iphone")) os = "iPhone";
        else if (s.contains("ipad")) os = "iPad";
        else if (s.contains("android")) os = "Android";
        else if (s.contains("mac os") || s.contains("macintosh")) os = "macOS";
        else if (s.contains("windows")) os = "Windows";
        else if (s.contains("linux")) os = "Linux";
        else os = "其他系统";
        String br;
        if (s.contains("edg/")) br = "Edge";
        else if (s.contains("opr/") || s.contains("opera")) br = "Opera";
        else if (s.contains("firefox")) br = "Firefox";
        else if (s.contains("chrome")) br = "Chrome";
        else if (s.contains("safari")) br = "Safari";
        else if (s.contains("curl")) br = "curl";
        else if (s.contains("postman")) br = "Postman";
        else br = "未知浏览器";
        return br + " · " + os;
    }
}
