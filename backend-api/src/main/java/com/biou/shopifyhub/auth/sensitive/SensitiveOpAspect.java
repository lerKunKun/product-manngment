package com.biou.shopifyhub.auth.sensitive;

import com.biou.shopifyhub.core.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Aspect
@Component
public class SensitiveOpAspect {

    private final SensitiveOpService service;

    public SensitiveOpAspect(SensitiveOpService service) {
        this.service = service;
    }

    @Around("@annotation(com.biou.shopifyhub.auth.sensitive.RequireSensitiveOp)")
    public Object check(ProceedingJoinPoint pjp) throws Throwable {
        MethodSignature sig = (MethodSignature) pjp.getSignature();
        RequireSensitiveOp ann = sig.getMethod().getAnnotation(RequireSensitiveOp.class);
        String action = ann.value();

        ServletRequestAttributes attr = (ServletRequestAttributes) RequestContextHolder.currentRequestAttributes();
        HttpServletRequest req = attr.getRequest();
        String token = req.getHeader("X-Sensitive-Token");

        Long uid = CurrentUser.userIdOrThrow();
        service.consumeOrThrow(uid, action, token);
        return pjp.proceed();
    }
}
