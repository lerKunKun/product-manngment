package com.biou.shopifyhub.product.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

@TableName("product_option")
public class ProductOption {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long productId;
    private String name;
    private Integer position;
    private String linkedTo;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Integer getPosition() { return position; }
    public void setPosition(Integer position) { this.position = position; }
    public String getLinkedTo() { return linkedTo; }
    public void setLinkedTo(String linkedTo) { this.linkedTo = linkedTo; }
}
