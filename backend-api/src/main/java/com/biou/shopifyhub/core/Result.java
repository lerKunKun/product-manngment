package com.biou.shopifyhub.core;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * 统一响应包装。前端约定：所有 /api/** 返回此结构。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Result<T>(
    int code,
    String message,
    T data,
    String ts
) {
    public static <T> Result<T> ok(T data) {
        return new Result<>(0, "OK", data, Instant.now().toString());
    }

    public static <T> Result<T> ok() {
        return ok(null);
    }

    public static <T> Result<T> error(int code, String message) {
        return new Result<>(code, message, null, Instant.now().toString());
    }

    public static <T> Result<T> error(ResultCode rc) {
        return new Result<>(rc.code(), rc.message(), null, Instant.now().toString());
    }

    public static <T> Result<T> error(ResultCode rc, String detail) {
        return new Result<>(rc.code(), rc.message() + ": " + detail, null, Instant.now().toString());
    }
}
