package com.biou.shopifyhub.invitation.service;

import com.biou.shopifyhub.invitation.dto.InvitationAcceptRequest;
import com.biou.shopifyhub.invitation.dto.InvitationCreateRequest;
import com.biou.shopifyhub.invitation.dto.InvitationListItem;
import com.biou.shopifyhub.invitation.dto.InvitationPreviewResponse;

import java.util.List;

public interface InvitationService {

    /** 列出指定用户能看到的邀请（按邀请人/上级范围）。 */
    List<InvitationListItem> list(Long viewerUserId, String statusFilter);


    /** 发起邀请。校验角色/范围/过期时间三必填，发送邀请邮件，返回 invitationId。 */
    Long create(InvitationCreateRequest req, Long invitedByUserId);

    /** 受邀人查看邀请基本信息（不含临时密码）。 */
    InvitationPreviewResponse preview(String token);

    /**
     * 接受邀请。校验 token + 临时密码，创建 sys_user/sys_user_role/sys_data_scope。
     * 返回新创建用户的 id（后续 Controller 据此签 JWT）。
     */
    Long accept(InvitationAcceptRequest req);

    /** 撤销 PENDING 邀请。 */
    void revokePending(Long invitationId, Long operatorUserId, String reason);

    /**
     * 注销已接受的临时账号：sys_user.status=EXPIRED + 关联 sys_data_scope 全部 REVOKED。
     */
    void revokeAcceptedUser(Long userId, Long operatorUserId, String reason);

    /**
     * 巡检到期账号：批量切 EXPIRED + 收回数据范围。返回处理条数。
     */
    int sweepExpired();
}
