package com.biou.shopifyhub.notification.subscription.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("notification_event_def")
public class NotificationEventDef {
    @TableId(type = IdType.INPUT)
    private String code;
    private String name;
    private String category;
    private String defaultChannels;
    private Boolean defaultSubscribed;
    private String description;
    private LocalDateTime createdAt;

    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getDefaultChannels() { return defaultChannels; }
    public void setDefaultChannels(String defaultChannels) { this.defaultChannels = defaultChannels; }
    public Boolean getDefaultSubscribed() { return defaultSubscribed; }
    public void setDefaultSubscribed(Boolean defaultSubscribed) { this.defaultSubscribed = defaultSubscribed; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
