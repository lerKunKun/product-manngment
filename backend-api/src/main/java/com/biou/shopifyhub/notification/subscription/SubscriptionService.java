package com.biou.shopifyhub.notification.subscription;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.notification.subscription.entity.NotificationEventDef;
import com.biou.shopifyhub.notification.subscription.entity.NotificationSubscription;
import com.biou.shopifyhub.notification.subscription.mapper.NotificationEventDefMapper;
import com.biou.shopifyhub.notification.subscription.mapper.NotificationSubscriptionMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 通知订阅 CRUD + isSubscribed 默认值决策。
 *
 * <p>设计要点：
 *  - 用户没有显式订阅记录时，按 event_def.default_subscribed + default_channels 决策（W4-NTF-01）
 *  - getMySubscriptions 会把所有 event_def 都补齐返回（用户感知一致）
 *  - updateMySubscriptions 是批量 upsert（按 user_id+event_code 唯一键）
 */
@Service
public class SubscriptionService {

    private final NotificationEventDefMapper defMapper;
    private final NotificationSubscriptionMapper subMapper;

    public SubscriptionService(NotificationEventDefMapper defMapper,
                               NotificationSubscriptionMapper subMapper) {
        this.defMapper = defMapper;
        this.subMapper = subMapper;
    }

    /** 拉所有事件定义（按 category 自然顺序分组）。 */
    public Map<String, List<NotificationEventDef>> listEventDefs() {
        List<NotificationEventDef> all = defMapper.selectList(null);
        Map<String, List<NotificationEventDef>> grouped = new LinkedHashMap<>();
        for (NotificationEventDef d : all) {
            grouped.computeIfAbsent(d.getCategory(), k -> new ArrayList<>()).add(d);
        }
        return grouped;
    }

    public List<NotificationEventDef> listEventDefsFlat() {
        return defMapper.selectList(null);
    }

    /**
     * 拉用户所有订阅设置：
     *  - 已显式订阅的用 DB 行
     *  - 没有显式订阅的用 event_def 默认值合成一条（id=null 表示尚未持久化）
     */
    public List<NotificationSubscription> getMySubscriptions(Long userId) {
        if (userId == null) return List.of();
        List<NotificationEventDef> defs = defMapper.selectList(null);
        List<NotificationSubscription> existing = subMapper.selectList(
            new LambdaQueryWrapper<NotificationSubscription>()
                .eq(NotificationSubscription::getUserId, userId)
        );
        Map<String, NotificationSubscription> byCode = new HashMap<>();
        for (NotificationSubscription s : existing) byCode.put(s.getEventCode(), s);

        List<NotificationSubscription> out = new ArrayList<>(defs.size());
        for (NotificationEventDef d : defs) {
            NotificationSubscription s = byCode.get(d.getCode());
            if (s == null) {
                s = new NotificationSubscription();
                s.setUserId(userId);
                s.setEventCode(d.getCode());
                s.setChannels(d.getDefaultChannels());
                s.setEnabled(Boolean.TRUE.equals(d.getDefaultSubscribed()));
            }
            out.add(s);
        }
        return out;
    }

    /** 批量 upsert。每条 (user_id, event_code) 走 UNIQUE 唯一键。 */
    @Transactional
    public void updateMySubscriptions(Long userId, List<NotificationSubscription> list) {
        if (userId == null || list == null) return;
        Set<String> validCodes = new HashSet<>();
        for (NotificationEventDef d : defMapper.selectList(null)) validCodes.add(d.getCode());

        for (NotificationSubscription req : list) {
            if (req.getEventCode() == null || !validCodes.contains(req.getEventCode())) continue;
            NotificationSubscription existing = subMapper.selectOne(
                new LambdaQueryWrapper<NotificationSubscription>()
                    .eq(NotificationSubscription::getUserId, userId)
                    .eq(NotificationSubscription::getEventCode, req.getEventCode())
            );
            String channels = normalizeChannels(req.getChannels());
            boolean enabled = req.getEnabled() == null ? true : req.getEnabled();
            if (existing == null) {
                NotificationSubscription s = new NotificationSubscription();
                s.setUserId(userId);
                s.setEventCode(req.getEventCode());
                s.setChannels(channels);
                s.setEnabled(enabled);
                subMapper.insert(s);
            } else {
                existing.setChannels(channels);
                existing.setEnabled(enabled);
                subMapper.updateById(existing);
            }
        }
    }

    /**
     * 是否订阅指定 channel。
     *  - 有显式订阅记录：按 enabled + channels 决策
     *  - 无显式订阅记录：按 event_def.default_subscribed + default_channels
     *  - event_def 不存在：按订阅，避免漏发关键通知
     */
    public boolean isSubscribed(Long userId, String eventCode, String channel) {
        if (userId == null || eventCode == null || channel == null) return false;
        NotificationSubscription sub = subMapper.selectOne(
            new LambdaQueryWrapper<NotificationSubscription>()
                .eq(NotificationSubscription::getUserId, userId)
                .eq(NotificationSubscription::getEventCode, eventCode)
        );
        if (sub != null) {
            if (!Boolean.TRUE.equals(sub.getEnabled())) return false;
            return containsChannel(sub.getChannels(), channel);
        }
        NotificationEventDef def = defMapper.selectById(eventCode);
        if (def == null) return true;
        if (!Boolean.TRUE.equals(def.getDefaultSubscribed())) return false;
        return containsChannel(def.getDefaultChannels(), channel);
    }

    static boolean containsChannel(String csv, String channel) {
        if (csv == null || csv.isBlank()) return false;
        for (String c : csv.split(",")) {
            if (c.trim().equalsIgnoreCase(channel)) return true;
        }
        return false;
    }

    static String normalizeChannels(String csv) {
        if (csv == null || csv.isBlank()) return "";
        Set<String> ok = Set.of("DINGTALK", "EMAIL", "INAPP");
        List<String> kept = new ArrayList<>();
        for (String c : csv.split(",")) {
            String t = c.trim().toUpperCase();
            if (ok.contains(t) && !kept.contains(t)) kept.add(t);
        }
        return String.join(",", kept);
    }

    static List<String> parseChannels(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
