package com.biou.shopifyhub.product.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.biou.shopifyhub.product.entity.Product;
import org.apache.ibatis.annotations.Mapper;

/**
 * Wave 1 简化：BaseMapper 提供基础 CRUD；数据范围在 service 层手动过滤。
 * Wave 2 加自定义查询方法标 @DataScope 走 DataScopeInterceptor 自动注入。
 */
@Mapper
public interface ProductMapper extends BaseMapper<Product> {
}
