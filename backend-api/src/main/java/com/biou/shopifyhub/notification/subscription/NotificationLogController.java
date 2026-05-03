package com.biou.shopifyhub.notification.subscription;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.notification.subscription.entity.NotificationLog;
import com.biou.shopifyhub.notification.subscription.mapper.NotificationLogMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Admin 通知发送日志查询/重试/统计。
 */
@RestController
@RequestMapping("/admin/notification-log")
public class NotificationLogController {

    private final NotificationLogMapper logMapper;
    private final NotificationSendService sendService;

    public NotificationLogController(NotificationLogMapper logMapper, NotificationSendService sendService) {
        this.logMapper = logMapper;
        this.sendService = sendService;
    }

    @GetMapping
    public Result<Page<NotificationLog>> list(@RequestParam(required = false) String eventCode,
                                              @RequestParam(required = false) String channel,
                                              @RequestParam(required = false) String status,
                                              @RequestParam(required = false) Long userId,
                                              @RequestParam(required = false) Instant from,
                                              @RequestParam(required = false) Instant to,
                                              @RequestParam(defaultValue = "1") int page,
                                              @RequestParam(defaultValue = "50") int size) {
        int safeSize = Math.min(Math.max(1, size), 200);
        int safePage = Math.max(1, page);
        LambdaQueryWrapper<NotificationLog> q = new LambdaQueryWrapper<>();
        if (eventCode != null && !eventCode.isBlank()) q.eq(NotificationLog::getEventCode, eventCode);
        if (channel != null && !channel.isBlank()) q.eq(NotificationLog::getChannel, channel);
        if (status != null && !status.isBlank()) q.eq(NotificationLog::getStatus, status);
        if (userId != null) q.eq(NotificationLog::getUserId, userId);
        if (from != null) q.ge(NotificationLog::getCreatedAt, toLocal(from));
        if (to != null) q.le(NotificationLog::getCreatedAt, toLocal(to));
        q.orderByDesc(NotificationLog::getId);
        Page<NotificationLog> p = logMapper.selectPage(new Page<>(safePage, safeSize), q);
        return Result.ok(p);
    }

    private static LocalDateTime toLocal(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneId.systemDefault());
    }

    @GetMapping("/{id}")
    public Result<NotificationLog> get(@PathVariable Long id) {
        NotificationLog row = logMapper.selectById(id);
        if (row == null) return Result.error(ResultCode.NOT_FOUND);
        return Result.ok(row);
    }

    @PostMapping("/{id}/retry")
    public Result<Boolean> retry(@PathVariable Long id) {
        NotificationLog row = logMapper.selectById(id);
        if (row == null) return Result.error(ResultCode.NOT_FOUND);
        boolean ok = sendService.retry(row);
        return Result.ok(ok);
    }

    @GetMapping("/stats")
    public Result<Map<String, Long>> stats(@RequestParam(required = false) Instant from,
                                           @RequestParam(required = false) Instant to) {
        Map<String, Long> result = new HashMap<>();
        for (String s : List.of("PENDING", "SENT", "FAILED", "SKIPPED")) {
            LambdaQueryWrapper<NotificationLog> q = new LambdaQueryWrapper<>();
            q.eq(NotificationLog::getStatus, s);
            if (from != null) q.ge(NotificationLog::getCreatedAt, toLocal(from));
            if (to != null) q.le(NotificationLog::getCreatedAt, toLocal(to));
            result.put(s, logMapper.selectCount(q));
        }
        return Result.ok(result);
    }
}
