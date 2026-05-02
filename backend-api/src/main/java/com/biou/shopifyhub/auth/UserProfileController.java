package com.biou.shopifyhub.auth;

import com.biou.shopifyhub.core.CurrentUser;
import com.biou.shopifyhub.core.Result;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.entity.SysUser;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.core.mapper.SysUserMapper;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/user")
public class UserProfileController {

    private final SysUserMapper userMapper;

    public UserProfileController(SysUserMapper userMapper) {
        this.userMapper = userMapper;
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
        dto.put("dingtalkUserId", u.getDingtalkUserid());
        return Result.ok(dto);
    }

    @PostMapping("/change-password")
    public Result<Void> changePassword(@org.springframework.web.bind.annotation.RequestBody ChangePwdReq req) {
        Long uid = CurrentUser.userIdOrThrow();
        SysUser u = userMapper.selectById(uid);
        if (u == null) throw new BusinessException(ResultCode.NOT_FOUND);
        if (u.getPasswordHash() == null || !BCrypt.checkpw(req.oldPassword, u.getPasswordHash())) {
            throw new BusinessException(ResultCode.AUTH_BAD_CREDENTIALS, "原密码不正确");
        }
        if (req.newPassword == null || req.newPassword.length() < 8) {
            throw new BusinessException(ResultCode.VALIDATION_FAILED, "新密码至少 8 位");
        }
        u.setPasswordHash(BCrypt.hashpw(req.newPassword, BCrypt.gensalt(12)));
        u.setPasswordMustChange(false);
        userMapper.updateById(u);
        return Result.ok();
    }

    public static class ChangePwdReq {
        @NotBlank public String oldPassword;
        @NotBlank @Size(min = 8, max = 64) public String newPassword;
    }
}
