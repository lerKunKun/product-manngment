package com.biou.shopifyhub.product.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

@TableName("product_metafield")
public class ProductMetafield {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long productId;
    /** namespace 是 SQL 关键字，需反引号转义 */
    @TableField(value = "`namespace`")
    private String namespace;
    /** key 也是 SQL 关键字 */
    @TableField(value = "`key`")
    private String key;
    private String value;
    private String type;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public String getNamespace() { return namespace; }
    public void setNamespace(String namespace) { this.namespace = namespace; }
    public String getKey() { return key; }
    public void setKey(String key) { this.key = key; }
    public String getValue() { return value; }
    public void setValue(String value) { this.value = value; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
}
