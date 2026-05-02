package com.biou.shopifyhub.invitation.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysDataScope;
import com.biou.shopifyhub.core.entity.SysRole;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.entity.SysUserRole;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysDataScopeMapper;
import com.biou.shopifyhub.core.mapper.SysRoleMapper;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.mapper.SysUserRoleMapper;
import com.biou.shopifyhub.invitation.InvitationProperties;
import com.biou.shopifyhub.invitation.dto.InvitationAcceptRequest;
import com.biou.shopifyhub.invitation.dto.InvitationCreateRequest;
import com.biou.shopifyhub.invitation.dto.InvitationListItem;
import com.biou.shopifyhub.invitation.dto.InvitationPreviewResponse;
import com.biou.shopifyhub.invitation.entity.UserInvitation;
import com.biou.shopifyhub.invitation.mapper.UserInvitationMapper;
import com.biou.shopifyhub.invitation.service.InvitationService;
import com.biou.shopifyhub.invitation.service.InvitationTokenGenerator;
import com.biou.shopifyhub.notification.EmailService;
import com.biou.shopifyhub.notification.InvitationEmailRenderer;
import com.biou.shopifyhub.notification.NotificationDispatcher;
import com.biou.shopifyhub.notification.NotificationEventCode;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Service
public class InvitationServiceImpl implements InvitationService {

    private static final Logger log = LoggerFactory.getLogger(InvitationServiceImpl.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final UserInvitationMapper invitationMapper;
    private final SysUserMapper userMapper;
    private final SysUserRoleMapper userRoleMapper;
    private final SysDataScopeMapper dataScopeMapper;
    private final SysRoleMapper roleMapper;
    private final InvitationProperties props;
    private final InvitationTokenGenerator tokenGen;
    private final EmailService emailService;
    private final InvitationEmailRenderer emailRenderer;
    private final NotificationDispatcher notifier;

    @Value("${APP_BRAND_NAME:Biou x Shopify Control Center}")
    private String brandName;

    public InvitationServiceImpl(
        UserInvitationMapper invitationMapper,
        SysUserMapper userMapper,
        SysUserRoleMapper userRoleMapper,
        SysDataScopeMapper dataScopeMapper,
        SysRoleMapper roleMapper,
        InvitationProperties props,
        InvitationTokenGenerator tokenGen,
        EmailService emailService,
        InvitationEmailRenderer emailRenderer,
        NotificationDispatcher notifier
    ) {
        this.invitationMapper = invitationMapper;
        this.userMapper = userMapper;
        this.userRoleMapper = userRoleMapper;
        this.dataScopeMapper = dataScopeMapper;
        this.roleMapper = roleMapper;
        this.props = props;
        this.tokenGen = tokenGen;
        this.emailService = emailService;
        this.emailRenderer = emailRenderer;
        this.notifier = notifier;
    }

    @Override
    @Transactional
    public Long create(InvitationCreateRequest req, Long invitedByUserId) {
        // 校验账号有效期 ∈ (now, now + maxAccountDays]
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime maxAllowed = now.plusDays(props.getMaxAccountDays());
        if (req.getAccountExpiresAt().isBefore(now.plusHours(1)) || req.getAccountExpiresAt().isAfter(maxAllowed)) {
            throw new BusinessException(ResultCode.INVITATION_DURATION_INVALID,
                "范围必须在 1 小时～" + props.getMaxAccountDays() + " 天之间");
        }

        // 同邮箱不可有 PENDING
        Long pending = invitationMapper.selectCount(new QueryWrapper<UserInvitation>()
            .eq("email", req.getEmail()).eq("status", "PENDING"));
        if (pending > 0) {
            throw new BusinessException(ResultCode.INVITATION_PENDING_EXISTS);
        }

        // 生成 token + 临时密码
        String token = tokenGen.generate(req.getEmail());
        String tempPwd = tokenGen.generateTempPassword();

        UserInvitation inv = new UserInvitation();
        inv.setEmail(req.getEmail());
        inv.setTargetCompanyId(req.getTargetCompanyId());
        inv.setTargetDeptId(req.getTargetDeptId());
        inv.setRoleCodes(toJson(req.getRoleCodes()));
        inv.setDataScopes(toJson(req.getDataScopes()));
        inv.setAccountExpiresAt(req.getAccountExpiresAt());
        inv.setInvitationToken(token);
        inv.setLinkExpiresAt(now.plus(Duration.ofHours(props.getLinkTtlHours())));
        inv.setInitialPasswordHash(BCrypt.hashpw(tempPwd, BCrypt.gensalt(12)));
        inv.setStatus("PENDING");
        inv.setInvitedBy(invitedByUserId);
        inv.setInvitedAt(now);
        invitationMapper.insert(inv);

        // 发邮件
        try {
            List<String> roleNames = lookupRoleNames(req.getRoleCodes());
            String acceptUrl = props.getLinkBase() + "?token=" + token;
            String html = emailRenderer.renderInvitation(new InvitationEmailRenderer.InvitationEmailContext(
                brandName,
                "Admin", // TODO: lookup invitedBy 用户姓名（W1-AUTH 完成后）
                "Company#" + req.getTargetCompanyId(), // TODO: 查公司名
                req.getTargetDeptId() == null ? null : "Dept#" + req.getTargetDeptId(),
                roleNames,
                req.getAccountExpiresAt(),
                tempPwd,
                acceptUrl
            ));
            emailService.sendHtml(req.getEmail(), "[" + brandName + "] 您被邀请加入系统", html);
        } catch (Exception e) {
            log.error("Send invitation email failed, but invitation row already created. id={}", inv.getId(), e);
        }

        log.info("Invitation created: id={} email={} expires_at={} invitedBy={}",
            inv.getId(), req.getEmail(), req.getAccountExpiresAt(), invitedByUserId);

        // 通知邀请人：邀请已发出
        notifier.notifyUser(
            invitedByUserId,
            NotificationEventCode.INVITATION_SENT,
            "[" + brandName + "] 邀请已发出",
            String.format("您已向 %s 发出临时员工邀请。账号有效期至 %s。",
                req.getEmail(), req.getAccountExpiresAt()),
            null
        );
        return inv.getId();
    }

    @Override
    public List<InvitationListItem> list(Long viewerUserId, String statusFilter) {
        QueryWrapper<UserInvitation> q = new QueryWrapper<UserInvitation>().orderByDesc("invited_at");
        if (statusFilter != null && !statusFilter.isBlank()) q.eq("status", statusFilter);
        // Wave 1 后期：按 viewer 的角色范围过滤；当前所有 PLATFORM_SUPER 行为
        return invitationMapper.selectList(q).stream().map(inv -> {
            InvitationListItem dto = new InvitationListItem();
            dto.setId(inv.getId());
            dto.setEmail(inv.getEmail());
            dto.setStatus(inv.getStatus());
            dto.setInvitedAt(inv.getInvitedAt());
            dto.setAccountExpiresAt(inv.getAccountExpiresAt());
            dto.setLinkExpiresAt(inv.getLinkExpiresAt());
            dto.setAcceptedAt(inv.getAcceptedAt());
            dto.setInvitedBy(inv.getInvitedBy());
            dto.setCreatedUserId(inv.getCreatedUserId());
            return dto;
        }).toList();
    }

    @Override
    public InvitationPreviewResponse preview(String token) {
        UserInvitation inv = findByTokenOrThrow(token);
        if (inv.getLinkExpiresAt().isBefore(LocalDateTime.now())) {
            throw new BusinessException(ResultCode.INVITATION_LINK_EXPIRED);
        }
        if ("ACCEPTED".equals(inv.getStatus())) throw new BusinessException(ResultCode.INVITATION_ALREADY_ACCEPTED);
        if ("REVOKED".equals(inv.getStatus())) throw new BusinessException(ResultCode.INVITATION_REVOKED);

        InvitationPreviewResponse resp = new InvitationPreviewResponse();
        resp.setEmail(inv.getEmail());
        resp.setCompanyName("Company#" + inv.getTargetCompanyId()); // TODO: lookup org
        if (inv.getTargetDeptId() != null) resp.setDeptName("Dept#" + inv.getTargetDeptId());
        resp.setRoleNames(lookupRoleNames(fromJsonList(inv.getRoleCodes())));
        resp.setAccountExpiresAt(inv.getAccountExpiresAt());
        resp.setInvitedAt(inv.getInvitedAt());
        return resp;
    }

    @Override
    @Transactional
    public Long accept(InvitationAcceptRequest req) {
        UserInvitation inv = findByTokenOrThrow(req.getToken());
        if (inv.getLinkExpiresAt().isBefore(LocalDateTime.now())) throw new BusinessException(ResultCode.INVITATION_LINK_EXPIRED);
        if ("ACCEPTED".equals(inv.getStatus())) throw new BusinessException(ResultCode.INVITATION_ALREADY_ACCEPTED);
        if ("REVOKED".equals(inv.getStatus())) throw new BusinessException(ResultCode.INVITATION_REVOKED);

        if (!BCrypt.checkpw(req.getTempPassword(), inv.getInitialPasswordHash())) {
            throw new BusinessException(ResultCode.INVITATION_PASSWORD_MISMATCH);
        }

        // 创建用户：employee_no 基于 invitation.id 生成，保证全局唯一 + 进程重启幂等
        SysUser u = new SysUser();
        u.setEmployeeNo("TMP" + String.format("%06d", inv.getId()));
        u.setUsername(inv.getEmail());
        u.setPasswordHash(inv.getInitialPasswordHash());
        u.setPasswordMustChange(true);
        u.setEmail(inv.getEmail());
        u.setUserType("TEMP");
        u.setExpiresAt(inv.getAccountExpiresAt());
        u.setStatus("ACTIVE");
        u.setDefaultTenantId(inv.getTargetCompanyId());
        u.setInvitedBy(inv.getInvitedBy());
        u.setInvitationId(inv.getId());
        userMapper.insert(u);

        // 绑定角色
        List<String> roleCodes = fromJsonList(inv.getRoleCodes());
        for (String code : roleCodes) {
            SysRole r = roleMapper.selectOne(new QueryWrapper<SysRole>().eq("code", code));
            if (r == null) {
                log.warn("Role not found, skip: {}", code);
                continue;
            }
            SysUserRole ur = new SysUserRole();
            ur.setUserId(u.getId());
            ur.setRoleId(r.getId());
            ur.setOrgId(inv.getTargetDeptId() != null ? inv.getTargetDeptId() : inv.getTargetCompanyId());
            userRoleMapper.insert(ur);
        }

        // 写入数据范围
        List<InvitationCreateRequest.DataScopeItem> scopes =
            fromJsonScopes(inv.getDataScopes());
        for (InvitationCreateRequest.DataScopeItem s : scopes) {
            SysDataScope ds = new SysDataScope();
            ds.setUserId(u.getId());
            ds.setScopeType(s.scopeType);
            ds.setScopeId(s.scopeId);
            ds.setAccess(s.access);
            ds.setGrantedBy(inv.getInvitedBy());
            ds.setGrantedAt(LocalDateTime.now());
            ds.setExpiresAt(inv.getAccountExpiresAt());
            ds.setSource("INVITATION");
            ds.setStatus("ACTIVE");
            dataScopeMapper.insert(ds);
        }

        // 标记邀请已接受
        UserInvitation upd = new UserInvitation();
        upd.setId(inv.getId());
        upd.setStatus("ACCEPTED");
        upd.setAcceptedAt(LocalDateTime.now());
        upd.setCreatedUserId(u.getId());
        invitationMapper.updateById(upd);

        log.info("Invitation accepted: id={} email={} new_user_id={}", inv.getId(), inv.getEmail(), u.getId());

        // 通知邀请人：邀请已被接受
        notifier.notifyUser(
            inv.getInvitedBy(),
            NotificationEventCode.INVITATION_ACCEPTED,
            "[" + brandName + "] 邀请已接受",
            String.format("您邀请的 %s 已接受邀请，新账号 %s 已创建（有效期至 %s）。",
                inv.getEmail(), u.getEmployeeNo(), inv.getAccountExpiresAt()),
            null
        );
        return u.getId();
    }

    @Override
    @Transactional
    public void revokePending(Long invitationId, Long operatorUserId, String reason) {
        UserInvitation inv = invitationMapper.selectById(invitationId);
        if (inv == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (!"PENDING".equals(inv.getStatus())) {
            throw new BusinessException(ResultCode.BUSINESS_ERROR, "仅 PENDING 状态可撤销");
        }
        UserInvitation upd = new UserInvitation();
        upd.setId(invitationId);
        upd.setStatus("REVOKED");
        upd.setRevokedBy(operatorUserId);
        upd.setRevokedAt(LocalDateTime.now());
        upd.setRevokeReason(reason);
        invitationMapper.updateById(upd);
    }

    @Override
    @Transactional
    public void revokeAcceptedUser(Long userId, Long operatorUserId, String reason) {
        SysUser u = userMapper.selectById(userId);
        if (u == null || !"TEMP".equals(u.getUserType())) {
            throw new BusinessException(ResultCode.BUSINESS_ERROR, "仅可注销临时账号");
        }
        u.setStatus("EXPIRED");
        u.setExpiredAt(LocalDateTime.now());
        userMapper.updateById(u);

        dataScopeMapper.update(null, new UpdateWrapper<SysDataScope>()
            .eq("user_id", userId)
            .eq("status", "ACTIVE")
            .set("status", "REVOKED"));
        log.info("Temp user revoked: id={} by={} reason={}", userId, operatorUserId, reason);
    }

    @Override
    @Transactional
    public int sweepExpired() {
        LocalDateTime now = LocalDateTime.now();
        List<SysUser> due = userMapper.selectList(new QueryWrapper<SysUser>()
            .eq("user_type", "TEMP")
            .eq("status", "ACTIVE")
            .le("expires_at", now));
        int count = 0;
        for (SysUser u : due) {
            u.setStatus("EXPIRED");
            u.setExpiredAt(now);
            userMapper.updateById(u);
            dataScopeMapper.update(null, new UpdateWrapper<SysDataScope>()
                .eq("user_id", u.getId())
                .eq("status", "ACTIVE")
                .set("status", "REVOKED"));

            // 通知邀请人：临时账号已到期
            if (u.getInvitedBy() != null) {
                notifier.notifyUser(
                    u.getInvitedBy(),
                    NotificationEventCode.TEMP_USER_EXPIRED,
                    "[" + brandName + "] 临时账号已到期",
                    String.format("临时账号 %s（%s）已到期，所有数据范围已收回。",
                        u.getEmployeeNo(), u.getEmail()),
                    null
                );
            }
            count++;
        }
        if (count > 0) log.info("[invitation-sweep] expired {} temp users", count);
        return count;
    }

    /**
     * 24h 内到期提醒（每天 09:00 跑）。
     */
    @Transactional(readOnly = true)
    public int notifyExpiringSoon() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime in24h = now.plusHours(24);
        List<SysUser> soon = userMapper.selectList(new QueryWrapper<SysUser>()
            .eq("user_type", "TEMP")
            .eq("status", "ACTIVE")
            .gt("expires_at", now)
            .le("expires_at", in24h));
        for (SysUser u : soon) {
            if (u.getInvitedBy() != null) {
                notifier.notifyUser(
                    u.getInvitedBy(),
                    NotificationEventCode.TEMP_USER_EXPIRING,
                    "[" + brandName + "] 临时账号 24h 内到期",
                    String.format("临时账号 %s（%s）将于 %s 到期，如需延长请重新发起邀请。",
                        u.getEmployeeNo(), u.getEmail(), u.getExpiresAt()),
                    null
                );
            }
        }
        return soon.size();
    }

    // ===== helpers =====

    private UserInvitation findByTokenOrThrow(String token) {
        UserInvitation inv = invitationMapper.selectOne(new QueryWrapper<UserInvitation>()
            .eq("invitation_token", token));
        if (inv == null) throw new BusinessException(ResultCode.NOT_FOUND, "邀请不存在或已失效");
        if (!tokenGen.verify(token, inv.getEmail())) {
            throw new BusinessException(ResultCode.NOT_FOUND, "邀请 token 无效");
        }
        return inv;
    }

    private List<String> lookupRoleNames(List<String> codes) {
        List<String> names = new ArrayList<>();
        for (String c : codes) {
            SysRole r = roleMapper.selectOne(new QueryWrapper<SysRole>().eq("code", c));
            names.add(r == null ? c : r.getName());
        }
        return names;
    }

    private static String toJson(Object o) {
        try { return JSON.writeValueAsString(o); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @SuppressWarnings("unchecked")
    private static <T> List<T> fromJsonList(String json) {
        try { return JSON.readValue(json, List.class); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static List<InvitationCreateRequest.DataScopeItem> fromJsonScopes(String json) {
        try {
            return JSON.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
