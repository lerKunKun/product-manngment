package com.biou.shopifyhub.core.security;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 一条登录会话信息。loginAt / lastSeenAt 为 epoch millis。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SessionInfo(
    String sid,
    String label,
    String userAgent,
    String ip,
    long loginAt,
    long lastSeenAt
) {}
