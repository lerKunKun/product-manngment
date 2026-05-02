package com.biou.shopifyhub.rbac.datascope;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标注在 Mapper 方法上：本次查询自动注入数据范围 WHERE。
 *
 * 例：@DataScope(scopeType = "STORE", idColumn = "id")
 *     代表表的 id 列要满足"用户在 sys_data_scope 中拥有该 STORE 的 ACTIVE 授权" 或 "用户所在 org 路径 == 该 store 所属 org"。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface DataScope {
    /** 范围类型：STORE / COMPANY / PRODUCT */
    String scopeType();

    /** 表上的主键列（被过滤的 scopeId 列），默认 id */
    String idColumn() default "id";

    /** 表别名（如有 join），默认无 */
    String tableAlias() default "";
}
