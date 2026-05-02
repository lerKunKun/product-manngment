package com.biou.shopifyhub.rbac.datascope;

import com.biou.shopifyhub.core.tenant.TenantContext;
import org.apache.ibatis.executor.statement.StatementHandler;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.plugin.*;
import org.apache.ibatis.reflection.MetaObject;
import org.apache.ibatis.reflection.SystemMetaObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.util.Properties;

/**
 * MyBatis 数据范围拦截器。
 *
 * Wave 1 简化版：
 *  - 拿当前 mapper 方法上的 @DataScope（通过 statementId 反射拿）
 *  - 在 SQL 末尾追加 AND ({idColumn} IN (SELECT scope_id FROM sys_data_scope WHERE user_id={uid} AND scope_type='X' AND status='ACTIVE'))
 *  - PLATFORM_SUPER 角色不限范围（W1-RBAC-04 完整化时按角色判断）
 *  - 当前 TenantContext.userId() 为 null 时不注入（开放路径或 dev 调用）
 *
 * 后续可优化：
 *  - 用 jsqlparser 精准注入（处理 join / 子查询场景）
 *  - 缓存用户 → scopeIds 映射，避免每次子查询
 *  - 支持 org.path 前缀匹配（store/product 关联到 owner_company_id）
 */
@Intercepts({
    @Signature(type = StatementHandler.class, method = "prepare",
        args = {Connection.class, Integer.class})
})
@Component
public class DataScopeInterceptor implements Interceptor {

    private static final Logger log = LoggerFactory.getLogger(DataScopeInterceptor.class);

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        StatementHandler handler = (StatementHandler) invocation.getTarget();
        MetaObject meta = SystemMetaObject.forObject(handler);

        MappedStatement ms = (MappedStatement) meta.getValue("delegate.mappedStatement");
        if (ms == null || !ms.getSqlCommandType().name().equals("SELECT")) {
            return invocation.proceed();
        }

        DataScope ann = resolveAnnotation(ms.getId());
        if (ann == null) return invocation.proceed();

        Long uid = TenantContext.userId();
        if (uid == null) return invocation.proceed(); // 未登录或 dev 内部调用，不限制

        BoundSql boundSql = (BoundSql) meta.getValue("delegate.boundSql");
        String original = boundSql.getSql();
        String injected = inject(original, ann, uid);
        if (!injected.equals(original)) {
            meta.setValue("delegate.boundSql.sql", injected);
            log.debug("[data-scope] mapper={} userId={} after inject:\n{}", ms.getId(), uid, injected);
        }
        return invocation.proceed();
    }

    @Override
    public Object plugin(Object target) {
        return target instanceof StatementHandler ? Plugin.wrap(target, this) : target;
    }

    @Override
    public void setProperties(Properties properties) {}

    private DataScope resolveAnnotation(String statementId) {
        int dot = statementId.lastIndexOf('.');
        if (dot <= 0) return null;
        String mapperClassName = statementId.substring(0, dot);
        String methodName = statementId.substring(dot + 1);
        try {
            Class<?> cls = Class.forName(mapperClassName);
            for (var m : cls.getDeclaredMethods()) {
                if (m.getName().equals(methodName) && m.isAnnotationPresent(DataScope.class)) {
                    return m.getAnnotation(DataScope.class);
                }
            }
        } catch (ClassNotFoundException ignored) {}
        return null;
    }

    private String inject(String sql, DataScope ds, long uid) {
        String col = ds.tableAlias().isEmpty() ? ds.idColumn() : ds.tableAlias() + "." + ds.idColumn();
        String filter = String.format(
            " AND %s IN (SELECT scope_id FROM sys_data_scope WHERE user_id=%d AND scope_type='%s' AND status='ACTIVE') ",
            col, uid, ds.scopeType().replace("'", ""));

        // 简化策略：找到第一个 ORDER BY / LIMIT / GROUP BY 之前插入；都没有就加在末尾
        String upper = sql.toUpperCase();
        int cut = -1;
        for (String kw : new String[]{" ORDER BY ", " GROUP BY ", " LIMIT "}) {
            int p = upper.lastIndexOf(kw);
            if (p > 0 && (cut == -1 || p < cut)) cut = p;
        }
        if (upper.contains(" WHERE ")) {
            return cut == -1
                ? sql + filter
                : sql.substring(0, cut) + filter + sql.substring(cut);
        } else {
            // 没有 WHERE，加 WHERE 1=1 兜底
            String fab = " WHERE 1=1 " + filter;
            return cut == -1
                ? sql + fab
                : sql.substring(0, cut) + fab + sql.substring(cut);
        }
    }
}
