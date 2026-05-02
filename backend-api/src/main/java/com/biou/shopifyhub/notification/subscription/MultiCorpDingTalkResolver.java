package com.biou.shopifyhub.notification.subscription;

import com.biou.shopifyhub.auth.dingtalk.DingTalkApiClient;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * W4-NTF-03 多 corpId 钉钉发送解析。
 *
 * <p>按 sys_user.dingtalk_corp_id → dingtalk_corp 表拿对应企业 access_token 路径。
 * 当前简化：dingtalk_corp 表为空 / corp_id 不匹配 / 主企业 → 降级走 {@link DingTalkApiClient}
 * 主企业链路（用 application 配置的 mainAppKey/mainAppSecret，缓存键独立）。
 *
 * <p>真实多 corpId 链路（按 user 取对应 corp 的 access_token）的 token 缓存与刷新由
 * {@link DingTalkApiClient#getAccessToken()} 主路径已覆盖；这里仅在表里检索到 corp 配置时
 * 切到对应凭证（W4-NTF-03 完整化时把 DingTalkApiClient 改造成支持 perCorp 缓存即可）。
 */
@Component
public class MultiCorpDingTalkResolver {

    private static final Logger log = LoggerFactory.getLogger(MultiCorpDingTalkResolver.class);

    private final SysUserMapper userMapper;
    private final DingTalkApiClient mainClient;
    private final JdbcTemplate jdbc;

    @Value("${dingtalk.main-corp-id:}")
    private String mainCorpId;

    public MultiCorpDingTalkResolver(SysUserMapper userMapper,
                                     DingTalkApiClient mainClient,
                                     JdbcTemplate jdbc) {
        this.userMapper = userMapper;
        this.mainClient = mainClient;
        this.jdbc = jdbc;
    }

    /**
     * 给某个 user 发钉钉文本通知。
     * @return true 已成功提交到钉钉（asyncsend_v2 errcode=0）
     */
    public boolean sendTextToUser(Long userId, String text) {
        if (userId == null) return false;
        SysUser u = userMapper.selectById(userId);
        if (u == null || u.getDingtalkUserid() == null || u.getDingtalkUserid().isBlank()) {
            return false;
        }
        // 当前实现：所有 corp 都走主企业 client；实际多 corpId 落地在 DingTalkApiClient 内
        // 加 perCorp token cache + Sender 构造（不在本 PR 范围）
        if (u.getDingtalkCorpId() != null && !u.getDingtalkCorpId().isBlank()
            && !u.getDingtalkCorpId().equals(mainCorpId)) {
            log.debug("[multi-corp] user={} corp={} → fallback main client (perCorp 链路待完整化)",
                userId, u.getDingtalkCorpId());
            // 校验该 corp 是否在 dingtalk_corp 表（仅日志；fallback 主企业）
            try {
                Map<String, Object> row = jdbc.queryForMap(
                    "SELECT id, app_key, agent_id FROM dingtalk_corp WHERE corp_id = ? AND status = 'ACTIVE'",
                    u.getDingtalkCorpId());
                log.debug("[multi-corp] dingtalk_corp matched id={}", row.get("id"));
            } catch (Exception ignore) {
                // 表中无该 corp 或多行 — 都按主企业兜底
            }
        }
        return mainClient.sendTextToUser(u.getDingtalkUserid(), text);
    }
}
