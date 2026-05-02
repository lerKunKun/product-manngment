package com.biou.shopifyhub.template.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "base_template_version", autoResultMap = true)
public class BaseTemplateVersion {
    @TableId(type = IdType.AUTO)
    private Long id;

    private Long templateId;
    private String version;
    private String zipR2Key;
    private Long zipBytes;
    private String zipSha256;
    private String defaultReplaceRulesJson;
    private String changelog;

    /** DRAFT / PUBLISHED / DEPRECATED */
    private String status;

    private Long createdBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
    @TableLogic
    private LocalDateTime deletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTemplateId() { return templateId; }
    public void setTemplateId(Long templateId) { this.templateId = templateId; }
    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }
    public String getZipR2Key() { return zipR2Key; }
    public void setZipR2Key(String zipR2Key) { this.zipR2Key = zipR2Key; }
    public Long getZipBytes() { return zipBytes; }
    public void setZipBytes(Long zipBytes) { this.zipBytes = zipBytes; }
    public String getZipSha256() { return zipSha256; }
    public void setZipSha256(String zipSha256) { this.zipSha256 = zipSha256; }
    public String getDefaultReplaceRulesJson() { return defaultReplaceRulesJson; }
    public void setDefaultReplaceRulesJson(String defaultReplaceRulesJson) { this.defaultReplaceRulesJson = defaultReplaceRulesJson; }
    public String getChangelog() { return changelog; }
    public void setChangelog(String changelog) { this.changelog = changelog; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
