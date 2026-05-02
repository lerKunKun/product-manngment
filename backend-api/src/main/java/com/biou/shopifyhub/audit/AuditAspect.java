package com.biou.shopifyhub.audit;

import com.biou.shopifyhub.audit.entity.SysAuditLog;
import com.biou.shopifyhub.audit.mapper.SysAuditLogMapper;
import com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp;
import com.biou.shopifyhub.core.tenant.TenantContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.util.Arrays;

/**
 * 审计 AOP：切所有 @RestController 的方法，写 sys_audit_log。
 *
 * 跳过项：
 *  - GET 请求（只读，量大不审计；如需可放开）
 *  - 健康检查、actuator、邀请预览等公开只读
 *
 * 敏感标记：方法上有 @RequireSensitiveOp 时 sensitive=true
 */
@Aspect
@Component
public class AuditAspect {

    private static final Logger log = LoggerFactory.getLogger(AuditAspect.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_PAYLOAD_LEN = 4000;

    private final SysAuditLogMapper mapper;

    public AuditAspect(SysAuditLogMapper mapper) {
        this.mapper = mapper;
    }

    @Around("within(@org.springframework.web.bind.annotation.RestController *)")
    public Object audit(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        Object result;
        Throwable error = null;
        try {
            result = pjp.proceed();
        } catch (Throwable t) {
            error = t;
            throw t;
        } finally {
            try {
                writeLog(pjp, error, System.currentTimeMillis() - start);
            } catch (Exception e) {
                log.warn("write audit log failed: {}", e.getMessage());
            }
        }
        return result;
    }

    @Async
    void writeLog(ProceedingJoinPoint pjp, Throwable error, long elapsedMs) {
        try {
            ServletRequestAttributes attr =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attr == null) return;
            HttpServletRequest req = attr.getRequest();
            String uri = req.getRequestURI();

            // 跳过审计：GET 只读 + 健康检查 + swagger
            String method = req.getMethod();
            if ("GET".equals(method)) return;
            if (uri.startsWith("/api/health") || uri.startsWith("/api/actuator")
                || uri.startsWith("/api/swagger") || uri.startsWith("/api/v3/api-docs")) return;

            MethodSignature sig = (MethodSignature) pjp.getSignature();
            Method m = sig.getMethod();
            Class<?> cls = m.getDeclaringClass();
            boolean sensitive = m.isAnnotationPresent(RequireSensitiveOp.class);

            SysAuditLog row = new SysAuditLog();
            row.setUserId(TenantContext.userId());
            row.setUsername(TenantContext.username());
            row.setTenantId(TenantContext.tenantId());
            row.setModule(cls.getSimpleName().replace("Controller", "").toLowerCase());
            row.setAction(m.getName());
            row.setRequestMethod(method);
            row.setRequestUri(uri);
            row.setRequestPayload(snipPayload(pjp.getArgs()));
            row.setResponseStatus(error == null ? 200 : 500);
            row.setIp(extractIp(req));
            row.setUserAgent(snip(req.getHeader("User-Agent"), 200));
            row.setSensitive(sensitive);
            row.setCreatedAt(LocalDateTime.now());
            mapper.insert(row);
        } catch (Exception e) {
            log.warn("audit row insert failed: {}", e.getMessage());
        }
    }

    private static String extractIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) return xff.split(",")[0].trim();
        return req.getRemoteAddr();
    }

    private static String snipPayload(Object[] args) {
        if (args == null || args.length == 0) return null;
        try {
            String s = JSON.writeValueAsString(Arrays.stream(args).filter(a ->
                !(a instanceof HttpServletRequest)
                && !(a instanceof jakarta.servlet.http.HttpServletResponse)
            ).toArray());
            return snip(s, MAX_PAYLOAD_LEN);
        } catch (Exception e) {
            return null;
        }
    }

    private static String snip(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) + "...[truncated]" : s;
    }
}
