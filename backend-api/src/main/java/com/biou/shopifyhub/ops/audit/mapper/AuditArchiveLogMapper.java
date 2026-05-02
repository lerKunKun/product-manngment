package com.biou.shopifyhub.ops.audit.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.biou.shopifyhub.ops.audit.entity.AuditArchiveLog;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface AuditArchiveLogMapper extends BaseMapper<AuditArchiveLog> {
}
