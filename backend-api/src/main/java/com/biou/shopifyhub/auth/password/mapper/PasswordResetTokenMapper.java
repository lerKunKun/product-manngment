package com.biou.shopifyhub.auth.password.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.biou.shopifyhub.auth.password.entity.PasswordResetToken;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface PasswordResetTokenMapper extends BaseMapper<PasswordResetToken> {
}
