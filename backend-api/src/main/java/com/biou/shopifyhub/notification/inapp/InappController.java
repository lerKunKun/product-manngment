package com.biou.shopifyhub.notification.inapp;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.notification.inapp.entity.InappMessage;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * W4-MAIL-02：站内信收件箱 REST。
 */
@RestController
@RequestMapping("/notification/inapp")
public class InappController {

    private final InappService service;

    public InappController(InappService service) {
        this.service = service;
    }

    @GetMapping
    public Result<Map<String, Object>> list(
        @RequestParam(defaultValue = "false") boolean unreadOnly,
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int size
    ) {
        Long uid = CurrentUser.userIdOrThrow();
        IPage<InappMessage> p = service.list(uid, unreadOnly, page, size);
        return Result.ok(Map.of(
            "items", p.getRecords(),
            "total", p.getTotal(),
            "page", p.getCurrent(),
            "size", p.getSize()
        ));
    }

    @GetMapping("/unread-count")
    public Result<Map<String, Long>> unreadCount() {
        Long uid = CurrentUser.userIdOrThrow();
        return Result.ok(Map.of("count", service.unreadCount(uid)));
    }

    @PostMapping("/{id}/read")
    public Result<Void> markRead(@PathVariable Long id) {
        Long uid = CurrentUser.userIdOrThrow();
        service.markRead(uid, id);
        return Result.ok();
    }

    @PostMapping("/read-all")
    public Result<Map<String, Integer>> markAllRead() {
        Long uid = CurrentUser.userIdOrThrow();
        int n = service.markAllRead(uid);
        return Result.ok(Map.of("updated", n));
    }

    /** 仅 dev 联调：手动注入一条测试站内信（仅自己给自己发）。 */
    @PostMapping("/_debug/self-send")
    public Result<Map<String, Long>> debugSelfSend(@RequestParam String subject,
                                                   @RequestParam(required = false) String body,
                                                   @RequestParam(required = false) String linkUrl) {
        Long uid = CurrentUser.userIdOrThrow();
        Long id = service.send(uid, "DEBUG", subject, body, body == null ? null : "<p>" + body + "</p>", linkUrl);
        return Result.ok(Map.of("id", id == null ? -1L : id));
    }
}
