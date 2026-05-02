package com.biou.shopifyhub.auth.sensitive;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标注在 Controller 方法上：调用此接口须先通过钉钉验证码二次确认。
 * 调用方式：
 *   1. POST /auth/sensitive/request {action} → 钉钉收到 6 位验证码
 *   2. POST /auth/sensitive/verify {action, code} → 拿到 X-Sensitive-Token（5 分钟有效）
 *   3. 在调用敏感接口时带 Header: X-Sensitive-Token
 *
 * action 用于绑定操作类别（如 SKU_BATCH_EDIT / DELETE_PRODUCT）防 token 复用到其他接口。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireSensitiveOp {
    /** 操作类别 code，与 request/verify 保持一致 */
    String value();
}
