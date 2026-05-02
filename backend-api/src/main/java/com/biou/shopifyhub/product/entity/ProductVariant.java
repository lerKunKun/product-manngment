package com.biou.shopifyhub.product.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@TableName("product_variant")
public class ProductVariant {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long productId;
    private String sku;
    private Integer position;
    private String option1;
    private String option2;
    private String option3;
    private BigDecimal grams;
    private String weightUnit;
    private String inventoryTracker;
    private Integer inventoryQty;
    /** deny / continue */
    private String inventoryPolicy;
    private String fulfillmentService;
    private BigDecimal price;
    private BigDecimal compareAtPrice;
    private Boolean requiresShipping;
    private Boolean taxable;
    private String barcode;
    private BigDecimal unitPriceTotalMeasure;
    private String unitPriceTotalMeasureUnit;
    private BigDecimal unitPriceBaseMeasure;
    private String unitPriceBaseMeasureUnit;
    private String variantImage;
    private String taxCode;
    private BigDecimal costPerItem;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
    @TableLogic
    private LocalDateTime deletedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public String getSku() { return sku; }
    public void setSku(String sku) { this.sku = sku; }
    public Integer getPosition() { return position; }
    public void setPosition(Integer position) { this.position = position; }
    public String getOption1() { return option1; }
    public void setOption1(String option1) { this.option1 = option1; }
    public String getOption2() { return option2; }
    public void setOption2(String option2) { this.option2 = option2; }
    public String getOption3() { return option3; }
    public void setOption3(String option3) { this.option3 = option3; }
    public BigDecimal getGrams() { return grams; }
    public void setGrams(BigDecimal grams) { this.grams = grams; }
    public String getWeightUnit() { return weightUnit; }
    public void setWeightUnit(String weightUnit) { this.weightUnit = weightUnit; }
    public String getInventoryTracker() { return inventoryTracker; }
    public void setInventoryTracker(String inventoryTracker) { this.inventoryTracker = inventoryTracker; }
    public Integer getInventoryQty() { return inventoryQty; }
    public void setInventoryQty(Integer inventoryQty) { this.inventoryQty = inventoryQty; }
    public String getInventoryPolicy() { return inventoryPolicy; }
    public void setInventoryPolicy(String inventoryPolicy) { this.inventoryPolicy = inventoryPolicy; }
    public String getFulfillmentService() { return fulfillmentService; }
    public void setFulfillmentService(String fulfillmentService) { this.fulfillmentService = fulfillmentService; }
    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
    public BigDecimal getCompareAtPrice() { return compareAtPrice; }
    public void setCompareAtPrice(BigDecimal compareAtPrice) { this.compareAtPrice = compareAtPrice; }
    public Boolean getRequiresShipping() { return requiresShipping; }
    public void setRequiresShipping(Boolean requiresShipping) { this.requiresShipping = requiresShipping; }
    public Boolean getTaxable() { return taxable; }
    public void setTaxable(Boolean taxable) { this.taxable = taxable; }
    public String getBarcode() { return barcode; }
    public void setBarcode(String barcode) { this.barcode = barcode; }
    public BigDecimal getUnitPriceTotalMeasure() { return unitPriceTotalMeasure; }
    public void setUnitPriceTotalMeasure(BigDecimal unitPriceTotalMeasure) { this.unitPriceTotalMeasure = unitPriceTotalMeasure; }
    public String getUnitPriceTotalMeasureUnit() { return unitPriceTotalMeasureUnit; }
    public void setUnitPriceTotalMeasureUnit(String unitPriceTotalMeasureUnit) { this.unitPriceTotalMeasureUnit = unitPriceTotalMeasureUnit; }
    public BigDecimal getUnitPriceBaseMeasure() { return unitPriceBaseMeasure; }
    public void setUnitPriceBaseMeasure(BigDecimal unitPriceBaseMeasure) { this.unitPriceBaseMeasure = unitPriceBaseMeasure; }
    public String getUnitPriceBaseMeasureUnit() { return unitPriceBaseMeasureUnit; }
    public void setUnitPriceBaseMeasureUnit(String unitPriceBaseMeasureUnit) { this.unitPriceBaseMeasureUnit = unitPriceBaseMeasureUnit; }
    public String getVariantImage() { return variantImage; }
    public void setVariantImage(String variantImage) { this.variantImage = variantImage; }
    public String getTaxCode() { return taxCode; }
    public void setTaxCode(String taxCode) { this.taxCode = taxCode; }
    public BigDecimal getCostPerItem() { return costPerItem; }
    public void setCostPerItem(BigDecimal costPerItem) { this.costPerItem = costPerItem; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
