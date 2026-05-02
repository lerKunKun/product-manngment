package com.biou.shopifyhub.audit.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.biou.shopifyhub.audit.entity.SysAuditLog;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface SysAuditLogMapper extends BaseMapper<SysAuditLog> {
}
