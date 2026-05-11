package com.biou.shopifyhub.core;

public enum ResultCode {
    SUCCESS(0, "OK"),

    // 4xx 客户端错误（10000~19999）
    BAD_REQUEST(10000, "请求参数错误"),
    UNAUTHORIZED(10001, "未登录或登录已过期"),
    FORBIDDEN(10002, "无权操作"),
    NOT_FOUND(10003, "资源不存在"),
    CONFLICT(10004, "资源冲突或重复"),
    VALIDATION_FAILED(10005, "参数校验失败"),

    // 业务错误（20000~29999）
    BUSINESS_ERROR(20000, "业务异常"),
    INVITATION_LINK_EXPIRED(20100, "邀请链接已过期"),
    INVITATION_PASSWORD_MISMATCH(20101, "临时密码不正确"),
    INVITATION_ALREADY_ACCEPTED(20102, "邀请已被接受"),
    INVITATION_REVOKED(20103, "邀请已被撤销"),
    INVITATION_DURATION_INVALID(20104, "账号有效期必须在 1~90 天之间"),
    INVITATION_PENDING_EXISTS(20105, "该邮箱已有待接受的邀请"),
    INVITATION_ROLE_NOT_ALLOWED(20106, "无权授予该角色"),
    INVITATION_USERNAME_TAKEN(20107, "该邮箱已被注册为系统用户，请联系管理员处理"),
    AUTH_BAD_CREDENTIALS(20200, "用户名或密码错误"),
    AUTH_ACCOUNT_FROZEN(20201, "账号已冻结"),
    AUTH_ACCOUNT_EXPIRED(20202, "账号已到期"),
    AUTH_LOCKED_TOO_MANY_ATTEMPTS(20203, "登录失败次数过多，请稍后再试"),

    // 5xx 服务端错误（50000~59999）
    INTERNAL_ERROR(50000, "服务器内部错误"),
    DEPENDENCY_DOWN(50001, "下游依赖不可用");

    private final int code;
    private final String message;

    ResultCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int code() { return code; }
    public String message() { return message; }
}
