package com.biou.shopifyhub.snapshot.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "product_inventory_history", autoResultMap = true)
public class ProductInventoryHistory {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long storeId;
    private String productExternalId;
    private String variantExternalId;
    private Integer inventoryQuantity;
    private Integer oldQuantity;
    private LocalDateTime changedAt;

    /** WEBHOOK / MANUAL / PUSH */
    private String source;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public Long getStoreId() { return storeId; }
    public void setStoreId(Long storeId) { this.storeId = storeId; }
    public String getProductExternalId() { return productExternalId; }
    public void setProductExternalId(String productExternalId) { this.productExternalId = productExternalId; }
    public String getVariantExternalId() { return variantExternalId; }
    public void setVariantExternalId(String variantExternalId) { this.variantExternalId = variantExternalId; }
    public Integer getInventoryQuantity() { return inventoryQuantity; }
    public void setInventoryQuantity(Integer inventoryQuantity) { this.inventoryQuantity = inventoryQuantity; }
    public Integer getOldQuantity() { return oldQuantity; }
    public void setOldQuantity(Integer oldQuantity) { this.oldQuantity = oldQuantity; }
    public LocalDateTime getChangedAt() { return changedAt; }
    public void setChangedAt(LocalDateTime changedAt) { this.changedAt = changedAt; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
}
