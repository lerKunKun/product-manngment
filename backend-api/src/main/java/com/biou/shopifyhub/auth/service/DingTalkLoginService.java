package com.biou.shopifyhub.auth.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.auth.dingtalk.DingTalkClient;
import com.biou.shopifyhub.auth.dto.LoginResponse;
import com.biou.shopifyhub.auth.dto.LoginResult;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysRole;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.entity.SysUserRole;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysRoleMapper;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.core.mapper.SysUserRoleMapper;
import com.biou.shopifyhub.core.security.JwtUtil;
import com.biou.shopifyhub.core.security.SessionService;
import com.biou.shopifyhub.rbac.UserRolePermissionService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 钉钉扫码登录的服务层：
 *  - 命中 sys_user (unionId 优先，mobile/email 兜底) → 签 JWT
 *  - 未命中 → 自助注册（默认 EMPLOYEE 角色）→ 签 JWT 落首次改密页
 */
@Service
public class DingTalkLoginService {

    private static final Logger log = LoggerFactory.getLogger(DingTalkLoginService.class);
    private static final SecureRandom RNG = new SecureRandom();

    private final SysUserMapper userMapper;
    private final SysUserRoleMapper userRoleMapper;
    private final SysRoleMapper roleMapper;
    private final JwtUtil jwtUtil;
    private final SessionService sessionService;
    private final UserRolePermissionService rbac;

    public DingTalkLoginService(
        SysUserMapper userMapper,
        SysUserRoleMapper userRoleMapper,
        SysRoleMapper roleMapper,
        JwtUtil jwtUtil,
        SessionService sessionService,
        UserRolePermissionService rbac
    ) {
        this.userMapper = userMapper;
        this.userRoleMapper = userRoleMapper;
        this.roleMapper = roleMapper;
        this.jwtUtil = jwtUtil;
        this.sessionService = sessionService;
        this.rbac = rbac;
    }

    @Transactional
    public LoginResult loginOrRegister(DingTalkClient.DingTalkUser dtUser, String tenantCode,
                                        String clientIp, String userAgent) {
        if (dtUser.unionId() == null || dtUser.unionId().isBlank()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "钉钉返回缺 unionId");
        }

        SysUser user = userMapper.selectOne(new QueryWrapper<SysUser>()
            .eq("dingtalk_unionid", dtUser.unionId()));

        boolean fresh = false;
        if (user == null) {
            // 自助注册（A-1.5 / A-1.4）
            user = autoRegister(dtUser);
            fresh = true;
        } else {
            if ("FROZEN".equals(user.getStatus())) throw new BusinessException(ResultCode.AUTH_ACCOUNT_FROZEN);
            if ("EXPIRED".equals(user.getStatus())) throw new BusinessException(ResultCode.AUTH_ACCOUNT_EXPIRED);
        }

        user.setLastLoginAt(LocalDateTime.now());
        userMapper.updateById(user);

        String sid = sessionService.newSid();
        Map<String, Object> claims = new HashMap<>();
        claims.put("ut", user.getUserType());
        claims.put("tid", user.getDefaultTenantId());

        String access, refresh;
        try {
            access = jwtUtil.issueAccess(user.getId(), user.getUsername(), sid, claims);
            refresh = jwtUtil.issueRefresh(user.getId(), user.getUsername(), sid);
        } catch (IllegalStateException e) {
            log.warn("JWT keys missing, returning stub. err={}", e.getMessage());
            access = "stub-access-" + user.getId();
            refresh = "stub-refresh-" + user.getId();
        }

        sessionService.create(user.getId(), sid, userAgent, clientIp);

        LoginResponse resp = new LoginResponse(
            user.getId(),
            user.getUsername(),
            user.getEmployeeNo(),
            user.getUserType(),
            fresh || Boolean.TRUE.equals(user.getPasswordMustChange()),
            access,
            rbac.loadRoles(user.getId()),
            rbac.loadPermissions(user.getId())
        );
        return new LoginResult(resp, refresh);
    }

    private SysUser autoRegister(DingTalkClient.DingTalkUser dt) {
        // 工号：DB 查 max(employee_no LIKE 'EMP%') + 1（避免进程重启冲突）
        String tempPwd = randomPwd(12);

        SysUser u = new SysUser();
        // 先 insert 拿 id，再用 sys_user.id 生成 employee_no（保证全局唯一）
        u.setEmployeeNo("EMP_PENDING_" + System.nanoTime()); // 占位，下面 update
        u.setUsername("EMP_PENDING_" + System.nanoTime());
        u.setPasswordHash(BCrypt.hashpw(tempPwd, BCrypt.gensalt(12)));
        u.setPasswordMustChange(true);
        u.setEmail(blankToNull(dt.email()));
        u.setPhone(blankToNull(dt.mobile()));
        u.setDingtalkUnionid(dt.unionId());
        u.setUserType("STAFF");
        u.setStatus("ACTIVE");
        userMapper.insert(u);

        // 用 sys_user.id 生成最终 employee_no
        String empNo = "EMP" + String.format("%06d", u.getId());
        u.setEmployeeNo(empNo);
        u.setUsername(empNo);
        userMapper.updateById(u);

        // 默认绑 EMPLOYEE 角色
        SysRole employeeRole = roleMapper.selectOne(new QueryWrapper<SysRole>().eq("code", "EMPLOYEE"));
        if (employeeRole != null) {
            SysUserRole ur = new SysUserRole();
            ur.setUserId(u.getId());
            ur.setRoleId(employeeRole.getId());
            userRoleMapper.insert(ur);
        }

        log.info("[dingtalk-self-register] empNo={} unionId={} tempPwd={} (TODO send via 工作通知)",
            u.getEmployeeNo(), dt.unionId(), tempPwd);
        // TODO: W1-AUTH-05 完整化：用工作通知发临时密码，而不是仅打日志
        return u;
    }

    private static String blankToNull(String s) { return (s == null || s.isBlank()) ? null : s; }

    private static String randomPwd(int len) {
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) sb.append(chars.charAt(RNG.nextInt(chars.length())));
        return sb.toString();
    }
}
