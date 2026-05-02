package com.biou.shopifyhub.notification;

/**
 * 通知事件 code 字典（对应《系统设计文档》8.12.1）。
 * 与 notification_event_def 表 + notification_subscription 表的 event_code 字段对齐。
 */
public final class NotificationEventCode {
    private NotificationEventCode() {}

    // 邀请相关
    public static final String INVITATION_SENT = "INVITATION_SENT";
    public static final String INVITATION_ACCEPTED = "INVITATION_ACCEPTED";
    public static final String TEMP_USER_EXPIRING = "TEMP_USER_EXPIRING";
    public static final String TEMP_USER_EXPIRED = "TEMP_USER_EXPIRED";

    // 钉钉同步 / 离职
    public static final String STAFF_FROZEN = "STAFF_FROZEN";

    // 后续模块
    public static final String NEW_STORE_SUCCESS = "NEW_STORE_SUCCESS";
    public static final String NEW_STORE_FAIL = "NEW_STORE_FAIL";
    public static final String PRODUCT_PUSH_FAIL = "PRODUCT_PUSH_FAIL";
    public static final String THEME_PUSH_SUCCESS = "THEME_PUSH_SUCCESS";
    public static final String THEME_PUSH_FAIL = "THEME_PUSH_FAIL";
    public static final String TOKEN_EXPIRING = "TOKEN_EXPIRING";
    public static final String BACKUP_FAIL = "BACKUP_FAIL";
    public static final String APPROVAL_PENDING = "APPROVAL_PENDING";
    public static final String APPROVAL_DECIDED = "APPROVAL_DECIDED";
    public static final String CROSS_AUTH_EXPIRING = "CROSS_AUTH_EXPIRING";
    public static final String HIGH_RISK_OP = "HIGH_RISK_OP";
}
