package com.biou.shopifyhub.org.dingtalk;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.mq.RabbitMqConfig;
import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import com.biou.shopifyhub.org.entity.SysOrg;
import com.biou.shopifyhub.org.mapper.SysOrgMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.Map;

/**
 * W1-ORG-03 钉钉事件消费者。
 * 处理事件：user_add_org / user_modify_org / user_leave_org / org_dept_create / org_dept_modify / org_dept_remove
 *
 * 注意：钉钉事件 payload 给的是 userid 列表（不是 unionId），需要后端再调钉钉服务端 API 拉详情才能拿到 unionId。
 * Wave 1 简化版：只在事件 payload 中能直接得到的字段做 sys_org 增删改 + sys_user.status 切换；
 * 完整字段同步留给 W1-ORG-04 全量兜底任务（拉钉钉部门树 + 全员）。
 */
@Component
public class DingTalkSyncConsumer {

    private static final Logger log = LoggerFactory.getLogger(DingTalkSyncConsumer.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final SysUserMapper userMapper;
    private final SysOrgMapper orgMapper;
    private final NotificationDispatcher notifier;

    public DingTalkSyncConsumer(SysUserMapper userMapper, SysOrgMapper orgMapper, NotificationDispatcher notifier) {
        this.userMapper = userMapper;
        this.orgMapper = orgMapper;
        this.notifier = notifier;
    }

    @RabbitListener(queues = RabbitMqConfig.DINGTALK_SYNC_QUEUE)
    public void onEvent(Map<String, Object> envelope,
                        Channel channel,
                        @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag) {
        try {
            String eventType = String.valueOf(envelope.get("eventType"));
            String payload = String.valueOf(envelope.get("payload"));
            log.info("[dingtalk-sync] handle event={}", eventType);
            try {
                JsonNode n = JSON.readTree(payload);
                switch (eventType) {
                    case "user_leave_org" -> handleUserLeave(n);
                    case "user_modify_org" -> handleUserModify(n);
                    case "user_add_org" -> handleUserAdd(n);
                    case "org_dept_create" -> handleDeptCreate(n);
                    case "org_dept_modify" -> handleDeptModify(n);
                    case "org_dept_remove" -> handleDeptRemove(n);
                    default -> log.warn("[dingtalk-sync] 未识别 event={}", eventType);
                }
            } catch (Exception e) {
                log.error("dingtalk sync consumer error: payload={} err={}", envelope, e.getMessage(), e);
                // do NOT throw — at-most-once: still ack to remove from queue (we logged it)
            }
        } finally {
            try {
                channel.basicAck(deliveryTag, false);
            } catch (IOException ackEx) {
                log.warn("dingtalk sync ack failed: deliveryTag={} err={}", deliveryTag, ackEx.getMessage());
            }
        }
    }

    @Transactional
    void handleUserLeave(JsonNode n) {
        // payload: { UserId: ["xxx"], TimeStamp: 123 }
        JsonNode ids = n.path("UserId");
        if (!ids.isArray()) return;
        for (JsonNode id : ids) {
            String dingUserId = id.asText();
            SysUser u = userMapper.selectOne(new QueryWrapper<SysUser>().eq("dingtalk_userid", dingUserId));
            if (u == null) {
                log.info("[dingtalk-sync] user_leave_org 未命中：dingUserId={}", dingUserId);
                continue;
            }
            u.setStatus("FROZEN");
            u.setFrozenAt(LocalDateTime.now());
            userMapper.updateById(u);
            log.info("[dingtalk-sync] FROZEN user id={} ding_userid={}", u.getId(), dingUserId);

            // 通知管理员
            // Wave 1 简化：通知 invitedBy（如果有），后续 W1-RBAC 完整化后通知所有 COMPANY_ADMIN
            if (u.getInvitedBy() != null) {
                notifier.notifyUser(
                    u.getInvitedBy(),
                    NotificationEventCode.STAFF_FROZEN,
                    "员工离职冷冻通知",
                    "用户 " + u.getUsername() + "（" + u.getEmployeeNo() + "）已被钉钉标记离职，冷冻 30 天后软删。",
                    null
                );
            }
        }
    }

    @Transactional
    void handleUserModify(JsonNode n) {
        // 简化：仅记日志，详细字段由全量兜底刷新
        log.info("[dingtalk-sync] user_modify_org received: {} (full sync 见 02:00 任务)", n);
    }

    @Transactional
    void handleUserAdd(JsonNode n) {
        // 钉钉用户首次添加时，事件给 userId；详细信息（unionId/name/...）需要服务端 API 拉
        // Wave 1 留给 W1-ORG-04 全量同步处理或自助注册时被动创建
        log.info("[dingtalk-sync] user_add_org received: {} (waiting on self-register or 02:00 sync)", n);
    }

    @Transactional
    void handleDeptCreate(JsonNode n) {
        JsonNode ids = n.path("DeptId");
        if (!ids.isArray()) return;
        for (JsonNode id : ids) {
            String deptId = id.asText();
            SysOrg existing = orgMapper.selectOne(new QueryWrapper<SysOrg>().eq("dingtalk_dept_id", deptId));
            if (existing != null) continue;
            // 占位创建（name 等待 02:00 兜底）
            SysOrg o = new SysOrg();
            o.setName("[同步中-" + deptId + "]");
            o.setCode("dt_" + deptId);
            o.setType("DEPT");
            o.setDingtalkDeptId(deptId);
            o.setStatus("ACTIVE");
            o.setSort(0);
            o.setPath("/?/");
            orgMapper.insert(o);
            o.setPath("/" + o.getId() + "/");
            orgMapper.updateById(o);
            log.info("[dingtalk-sync] org_dept_create stub deptId={} sysOrgId={}", deptId, o.getId());
        }
    }

    @Transactional
    void handleDeptModify(JsonNode n) {
        log.info("[dingtalk-sync] org_dept_modify: {} (留 02:00 全量兜底刷新名称)", n);
    }

    @Transactional
    void handleDeptRemove(JsonNode n) {
        JsonNode ids = n.path("DeptId");
        if (!ids.isArray()) return;
        for (JsonNode id : ids) {
            String deptId = id.asText();
            SysOrg o = orgMapper.selectOne(new QueryWrapper<SysOrg>().eq("dingtalk_dept_id", deptId));
            if (o != null) {
                orgMapper.deleteById(o.getId());
                log.info("[dingtalk-sync] org_dept_remove sysOrgId={}", o.getId());
            }
        }
    }
}
