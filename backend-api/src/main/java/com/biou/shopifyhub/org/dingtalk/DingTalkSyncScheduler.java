package com.biou.shopifyhub.org.dingtalk;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.biou.shopifyhub.auth.dingtalk.DingTalkApiClient;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

/**
 * W1-ORG-04 每日 02:00 全量兜底：
 *  - 拉钉钉部门树（topapi/v2/department/listsub）+ 全员
 *  - diff 本地 sys_org / sys_user，补漏修偏（事件丢失场景）
 *  - 写 sys_org_dingtalk_sync_log
 *
 * W1-ORG-05 离职冷冻软删：
 *  - 每天 03:30 扫 status=FROZEN AND frozen_at <= now-30d → status=DELETED + deleted_at
 *
 * 注意：完整全量同步实现需要分页拉钉钉 dept tree + per-dept user_list，调用很多。
 * Wave 1 仅提供骨架 + 离职软删；完整刷新留 W2 优化。
 */
@Component
public class DingTalkSyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(DingTalkSyncScheduler.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();

    private final DingTalkApiClient dingApi;
    private final SysUserMapper userMapper;

    public DingTalkSyncScheduler(DingTalkApiClient dingApi, SysUserMapper userMapper) {
        this.dingApi = dingApi;
        this.userMapper = userMapper;
    }

    /** 每日 02:00 全量兜底（W1-ORG-04） */
    @Scheduled(cron = "${dingtalk.full-sync-cron:0 0 2 * * *}")
    public void fullSync() {
        log.info("[dingtalk-full-sync] start");
        try {
            String token = dingApi.getAccessToken();
            // 拉根部门下子部门列表（dept_id=1 是钉钉根部门）
            // 完整：递归 + 每个部门拉用户。这里只做存活探针，证明 token 链路通。
            String url = "https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=" + token;
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString("{\"dept_id\":1}"))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(resp.body());
            int errcode = n.path("errcode").asInt(-1);
            if (errcode != 0) {
                log.warn("[dingtalk-full-sync] dept list 失败: {}", resp.body());
                return;
            }
            int childCount = n.path("result").size();
            log.info("[dingtalk-full-sync] 根部门下子部门 {} 个，详细 diff 留 W2 优化", childCount);
        } catch (Exception e) {
            log.error("[dingtalk-full-sync] 失败", e);
        }
    }

    /** 每日 03:30：FROZEN 30 天 → DELETED（W1-ORG-05） */
    @Scheduled(cron = "${dingtalk.frozen-sweep-cron:0 30 3 * * *}")
    public void sweepFrozen() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(30);
        List<SysUser> due = userMapper.selectList(new QueryWrapper<SysUser>()
            .eq("status", "FROZEN")
            .le("frozen_at", cutoff));
        if (due.isEmpty()) return;
        for (SysUser u : due) {
            u.setStatus("DELETED");
            u.setDeletedAt(LocalDateTime.now());
            // 注意：MyBatis-Plus 逻辑删除时 update 会自动改 deleted_at；这里直接 update_status 兼用
            userMapper.update(null, new UpdateWrapper<SysUser>()
                .eq("id", u.getId())
                .set("status", "DELETED")
                .set("deleted_at", LocalDateTime.now()));
        }
        log.info("[frozen-sweep] {} FROZEN users moved to DELETED", due.size());
    }
}
