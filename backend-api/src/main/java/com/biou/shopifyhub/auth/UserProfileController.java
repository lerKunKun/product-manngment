package com.biou.shopifyhub.auth;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import com.biou.shopifyhub.org.entity.SysOrg;
import com.biou.shopifyhub.org.mapper.SysOrgMapper;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/user")
public class UserProfileController {

    private static final Logger log = LoggerFactory.getLogger(UserProfileController.class);

    private final SysUserMapper userMapper;
    private final SysOrgMapper orgMapper;

    public UserProfileController(SysUserMapper userMapper, SysOrgMapper orgMapper) {
        this.userMapper = userMapper;
        this.orgMapper = orgMapper;
    }

    @GetMapping("/me")
    public Result<Map<String, Object>> me() {
        Long uid = CurrentUser.userIdOrThrow();
        SysUser u = userMapper.selectById(uid);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", u.getId());
        dto.put("employeeNo", u.getEmployeeNo());
        dto.put("username", u.getUsername());
        dto.put("email", u.getEmail());
        dto.put("phone", u.getPhone());
        dto.put("userType", u.getUserType());
        dto.put("status", u.getStatus());
        dto.put("expiresAt", u.getExpiresAt());
        dto.put("passwordMustChange", u.getPasswordMustChange());
        // 钉钉首登用户 password_hash 为 NULL → 前端走「设置本地密码」分支，不要求原密码
        dto.put("hasPassword", u.getPasswordHash() != null);
        dto.put("dingtalkUserId", u.getDingtalkUserid());
        dto.put("avatarUrl", u.getAvatarUrl());
        dto.put("position", u.getPosition());
        // companyName: 通过 default_tenant_id 关联 sys_org 的 COMPANY 节点取 name
        String companyName = null;
        if (u.getDefaultTenantId() != null) {
            QueryWrapper<SysOrg> q = new QueryWrapper<>();
            q.eq("tenant_id", u.getDefaultTenantId())
             .eq("type", "COMPANY")
             .last("LIMIT 1");
            List<SysOrg> orgs = orgMapper.selectList(q);
            if (!orgs.isEmpty()) {
                companyName = orgs.get(0).getName();
            }
        }
        dto.put("companyName", companyName);
        return Result.ok(dto);
    }

    @PostMapping("/change-password")
    public Result<Void> changePassword(@org.springframework.web.bind.annotation.RequestBody ChangePwdReq req) {
        Long uid = CurrentUser.userIdOrThrow();
        SysUser u = userMapper.selectById(uid);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (req.newPassword == null || req.newPassword.length() < 8) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "新密码至少 8 位");
        }
        if (u.getPasswordHash() == null) {
            // 首次设置本地密码（钉钉自助注册用户）：不要求 oldPassword
            log.info("[user-set-password-first] userId={}", uid);
        } else {
            // 已有本地密码：必须验旧的
            if (req.oldPassword == null || req.oldPassword.isBlank()
                || !BCrypt.checkpw(req.oldPassword, u.getPasswordHash())) {
                throw new BusinessException(ResultCode.AUTH_BAD_CREDENTIALS, "原密码不正确");
            }
        }
        u.setPasswordHash(BCrypt.hashpw(req.newPassword, BCrypt.gensalt(12)));
        u.setPasswordMustChange(false);
        userMapper.updateById(u);
        return Result.ok();
    }

    public static class ChangePwdReq {
        // 首次设置本地密码（password_hash=NULL）时可空；其它场景必填
        public String oldPassword;
        @NotBlank @Size(min = 8, max = 64) public String newPassword;
    }
}
