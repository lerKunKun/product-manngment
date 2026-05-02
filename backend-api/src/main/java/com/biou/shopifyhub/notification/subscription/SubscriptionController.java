package com.biou.shopifyhub.notification.subscription;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.notification.subscription.entity.NotificationEventDef;
import com.biou.shopifyhub.notification.subscription.entity.NotificationSubscription;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/notification")
public class SubscriptionController {

    private final SubscriptionService service;

    public SubscriptionController(SubscriptionService service) {
        this.service = service;
    }

    /** 列出所有事件定义（按 category 分组）。 */
    @GetMapping("/events")
    public Result<Map<String, List<NotificationEventDef>>> listEvents() {
        return Result.ok(service.listEventDefs());
    }

    /** 我的订阅设置（已订阅 + 默认补齐）。 */
    @GetMapping("/subscriptions/me")
    public Result<List<NotificationSubscription>> getMine() {
        Long uid = CurrentUser.userIdOrThrow();
        return Result.ok(service.getMySubscriptions(uid));
    }

    /** 批量更新我的订阅。 */
    @PutMapping("/subscriptions/me")
    public Result<Void> updateMine(@RequestBody List<NotificationSubscription> list) {
        Long uid = CurrentUser.userIdOrThrow();
        service.updateMySubscriptions(uid, list);
        return Result.ok();
    }
}
