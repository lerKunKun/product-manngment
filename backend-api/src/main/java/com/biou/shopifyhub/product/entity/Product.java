package com.biou.shopifyhub.product.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("product")
public class Product {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long ownerCompanyId;
    private Long ownerDeptId;
    private String handle;
    private String title;
    private String bodyHtml;
    private String vendor;
    private String productCategory;
    private String type;
    private String tags;
    private Boolean published;
    private String seoTitle;
    private String seoDescription;
    /** active / draft / archived */
    private String status;
    /** Shopify product.template_suffix — 决定店铺端使用哪个 product.<suffix>.liquid 模板（V40） */
    private String templateSuffix;
    private Long createdBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
    @TableLogic
    private LocalDateTime deletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getOwnerCompanyId() { return ownerCompanyId; }
    public void setOwnerCompanyId(Long ownerCompanyId) { this.ownerCompanyId = ownerCompanyId; }
    public Long getOwnerDeptId() { return ownerDeptId; }
    public void setOwnerDeptId(Long ownerDeptId) { this.ownerDeptId = ownerDeptId; }
    public String getHandle() { return handle; }
    public void setHandle(String handle) { this.handle = handle; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getBodyHtml() { return bodyHtml; }
    public void setBodyHtml(String bodyHtml) { this.bodyHtml = bodyHtml; }
    public String getVendor() { return vendor; }
    public void setVendor(String vendor) { this.vendor = vendor; }
    public String getProductCategory() { return productCategory; }
    public void setProductCategory(String productCategory) { this.productCategory = productCategory; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getTags() { return tags; }
    public void setTags(String tags) { this.tags = tags; }
    public Boolean getPublished() { return published; }
    public void setPublished(Boolean published) { this.published = published; }
    public String getSeoTitle() { return seoTitle; }
    public void setSeoTitle(String seoTitle) { this.seoTitle = seoTitle; }
    public String getSeoDescription() { return seoDescription; }
    public void setSeoDescription(String seoDescription) { this.seoDescription = seoDescription; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getTemplateSuffix() { return templateSuffix; }
    public void setTemplateSuffix(String templateSuffix) { this.templateSuffix = templateSuffix; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
