package com.biou.shopifyhub.push.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "store_product_variant", autoResultMap = true)
public class StoreProductVariant {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long storeProductId;
    private Long productVariantId;
    private String shopifyVariantId;
    private String sku;
    private String shopifyInventoryItemId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
    @TableLogic
    private LocalDateTime deletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getStoreProductId() { return storeProductId; }
    public void setStoreProductId(Long storeProductId) { this.storeProductId = storeProductId; }
    public Long getProductVariantId() { return productVariantId; }
    public void setProductVariantId(Long productVariantId) { this.productVariantId = productVariantId; }
    public String getShopifyVariantId() { return shopifyVariantId; }
    public void setShopifyVariantId(String shopifyVariantId) { this.shopifyVariantId = shopifyVariantId; }
    public String getSku() { return sku; }
    public void setSku(String sku) { this.sku = sku; }
    public String getShopifyInventoryItemId() { return shopifyInventoryItemId; }
    public void setShopifyInventoryItemId(String shopifyInventoryItemId) { this.shopifyInventoryItemId = shopifyInventoryItemId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
