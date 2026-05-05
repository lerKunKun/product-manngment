package com.biou.shopifyhub.invitation.controller;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.invitation.dto.InvitationAcceptRequest;
import com.biou.shopifyhub.invitation.dto.InvitationCreateRequest;
import com.biou.shopifyhub.invitation.dto.InvitationListItem;
import com.biou.shopifyhub.invitation.dto.InvitationPreviewResponse;
import com.biou.shopifyhub.invitation.service.InvitationService;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/invitation")
public class InvitationController {

    private final InvitationService service;

    public InvitationController(InvitationService service) {
        this.service = service;
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
    public Result<Map<String, Long>> accept(@Valid @RequestBody InvitationAcceptRequest req) {
        Long userId = service.accept(req);
        // TODO: W1-AUTH 完整后此处直接签发 JWT 返回，免登录
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
