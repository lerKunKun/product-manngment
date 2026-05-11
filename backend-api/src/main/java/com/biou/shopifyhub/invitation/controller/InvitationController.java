package com.biou.shopifyhub.invitation.controller;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.security.CookieUtil;
import com.biou.shopifyhub.invitation.dto.InvitationAcceptRequest;
import com.biou.shopifyhub.invitation.dto.InvitationCreateRequest;
import com.biou.shopifyhub.invitation.dto.InvitationListItem;
import com.biou.shopifyhub.invitation.dto.InvitationPreviewResponse;
import com.biou.shopifyhub.invitation.service.InvitationService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/invitation")
public class InvitationController {

    private final InvitationService service;
    private final CookieUtil cookieUtil;

    public InvitationController(InvitationService service, CookieUtil cookieUtil) {
        this.service = service;
        this.cookieUtil = cookieUtil;
    }

    /** 列表（PENDING / ACCEPTED / REVOKED / LINK_EXPIRED）。 */
    @GetMapping
    @PreAuthorize("hasAuthority('PERM_TEMP_USER:LIST')")
    public Result<List<InvitationListItem>> list(@RequestParam(required = false) String status) {
        return Result.ok(service.list(CurrentUser.userIdOrNull(), status));
    }

    @PostMapping("/create")
    @PreAuthorize("hasAuthority('PERM_TEMP_USER:INVITE')")
    public Result<Map<String, Long>> create(@Valid @RequestBody InvitationCreateRequest req) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L; // dev fallback for local调试 → 走默认 admin
        Long id = service.create(req, uid);
        return Result.ok(Map.of("invitationId", id));
    }

    @GetMapping("/preview")
    public Result<InvitationPreviewResponse> preview(@RequestParam String token) {
        return Result.ok(service.preview(token));
    }

    @PostMapping("/accept")
    public Result<Map<String, Long>> accept(@Valid @RequestBody InvitationAcceptRequest req,
                                            HttpServletResponse resp) {
        Long userId = service.accept(req);
        // 抹掉调用方浏览器可能携带的旧 refresh cookie（典型场景：admin 在同一浏览器里
        // 点了自己发出的邀请链接来接受 —— 不清就会导致接受成功后旧 admin session
        // 借 refresh cookie 自动续期，前端看起来"接受邀请却进了 admin 后台"）。
        // TODO: W1-AUTH 完整后此处直接签发 JWT 返回，免登录
        cookieUtil.clearRefresh(resp);
        return Result.ok(Map.of("userId", userId));
    }

    @PostMapping("/{id}/revoke")
    @PreAuthorize("hasAuthority('PERM_TEMP_USER:REVOKE')")
    public Result<Void> revoke(@PathVariable Long id, @RequestParam(required = false) String reason) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.revokePending(id, uid, reason);
        return Result.ok();
    }

    @PostMapping("/users/{userId}/revoke")
    @PreAuthorize("hasAuthority('PERM_TEMP_USER:REVOKE')")
    public Result<Void> revokeUser(@PathVariable Long userId, @RequestParam(required = false) String reason) {
        Long uid = CurrentUser.userIdOrNull();
        if (uid == null) uid = 1L;
        service.revokeAcceptedUser(userId, uid, reason);
        return Result.ok();
    }
}
