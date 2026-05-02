package com.biou.shopifyhub.auth.sensitive;

import com.biou.shopifyhub.auth.dingtalk.DingTalkApiClient;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;

/**
 * 危险操作二次确认。
 * Redis key 设计：
 *  - sens:code:{userId}:{action}      → 6 位验证码（5 分钟）
 *  - sens:token:{token}                → "{userId}:{action}"（5 分钟）
 */
@Service
public class SensitiveOpService {

    private static final Logger log = LoggerFactory.getLogger(SensitiveOpService.class);
    private static final SecureRandom RNG = new SecureRandom();
    private static final Duration CODE_TTL = Duration.ofMinutes(5);
    private static final Duration TOKEN_TTL = Duration.ofMinutes(5);

    private final StringRedisTemplate redis;
    private final SysUserMapper userMapper;
    private final DingTalkApiClient dingTalk;

    public SensitiveOpService(StringRedisTemplate redis, SysUserMapper userMapper, DingTalkApiClient dingTalk) {
        this.redis = redis;
        this.userMapper = userMapper;
        this.dingTalk = dingTalk;
    }

    /** 发码：生成 6 位随机码 + Redis 缓存 + 钉钉工作通知。 */
    public void requestCode(Long userId, String action) {
        if (userId == null) throw new BusinessException(ResultCode.UNAUTHORIZED);
        SysUser u = userMapper.selectById(userId);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");

        String code = String.format("%06d", RNG.nextInt(1_000_000));
        String key = codeKey(userId, action);
        redis.opsForValue().set(key, code, CODE_TTL);

        String text = String.format(
            "您正在执行敏感操作 [%s]，验证码：%s（5 分钟有效）。如非本人操作请忽略并联系管理员。",
            action, code
        );
        boolean sent = dingTalk.sendTextToUser(u.getDingtalkUserid(), text);
        if (!sent) {
            // 钉钉不可达时，本地日志（dev 阶段）方便测试；生产应该报错或走邮件
            log.warn("[sensitive-op] 钉钉发码失败，本地降级日志：userId={} action={} code={}",
                userId, action, code);
        }
    }

    /** 用 6 位码换 token。 */
    public String verify(Long userId, String action, String code) {
        if (userId == null) throw new BusinessException(ResultCode.UNAUTHORIZED);
        String key = codeKey(userId, action);
        String saved = redis.opsForValue().get(key);
        if (saved == null) throw new BusinessException(ResultCode.BUSINESS_ERROR, "验证码已过期或未发送");
        if (!saved.equals(code)) throw new BusinessException(ResultCode.BUSINESS_ERROR, "验证码错误");
        redis.delete(key);

        String token = "stk_" + Base64.getUrlEncoder().withoutPadding()
            .encodeToString(UUID.randomUUID().toString().getBytes());
        redis.opsForValue().set(tokenKey(token), userId + ":" + action, TOKEN_TTL);
        return token;
    }

    /** AOP 切面调用：校验 token 有效且与 (userId, action) 匹配；通过后即时失效（一次性）。 */
    public void consumeOrThrow(Long userId, String action, String token) {
        if (token == null || token.isBlank()) {
            throw new BusinessException(ResultCode.FORBIDDEN, "缺 X-Sensitive-Token");
        }
        String saved = redis.opsForValue().get(tokenKey(token));
        if (saved == null) throw new BusinessException(ResultCode.FORBIDDEN, "Token 已过期或被消费");
        String expect = userId + ":" + action;
        if (!expect.equals(saved)) throw new BusinessException(ResultCode.FORBIDDEN, "Token 与操作不匹配");
        redis.delete(tokenKey(token));
    }

    private static String codeKey(Long userId, String action) {
        return "sens:code:" + userId + ":" + action;
    }

    private static String tokenKey(String token) {
        return "sens:token:" + token;
    }
}
