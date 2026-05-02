package com.biou.shopifyhub.product.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("product_external_link")
public class ProductExternalLink {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long productId;
    /** AD / BENCHMARK / MATERIAL */
    private String kind;
    private String url;
    private String note;
    private Long createdBy;
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public String getKind() { return kind; }
    public void setKind(String kind) { this.kind = kind; }
    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
