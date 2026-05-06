package com.biou.shopifyhub.template.binding;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 店铺与基础模板版本的绑定（Track AS5）。一店一行，唯一键 {@code uk_store(store_id)}。
 *
 * <p>{@code base_template_version_id} 指向 {@code base_template_version.id}，决定推送
 * 时使用哪条 {@code default_replace_rules_json}。{@code custom_replace_rules_json}
 * 是该店额外覆盖/扩展的 JSON（同 key 覆盖默认）。
 */
@TableName("store_template_binding")
public class StoreTemplateBinding {
    @TableId(type = IdType.AUTO)
    private Long id;

    private Long storeId;
    private Long baseTemplateVersionId;
    private String customReplaceRulesJson;
    private LocalDateTime boundAt;
    private Long boundBy;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getStoreId() { return storeId; }
    public void setStoreId(Long storeId) { this.storeId = storeId; }
    public Long getBaseTemplateVersionId() { return baseTemplateVersionId; }
    public void setBaseTemplateVersionId(Long baseTemplateVersionId) { this.baseTemplateVersionId = baseTemplateVersionId; }
    public String getCustomReplaceRulesJson() { return customReplaceRulesJson; }
    public void setCustomReplaceRulesJson(String customReplaceRulesJson) { this.customReplaceRulesJson = customReplaceRulesJson; }
    public LocalDateTime getBoundAt() { return boundAt; }
    public void setBoundAt(LocalDateTime boundAt) { this.boundAt = boundAt; }
    public Long getBoundBy() { return boundBy; }
    public void setBoundBy(Long boundBy) { this.boundBy = boundBy; }
}
