package com.biou.shopifyhub.product.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;

import java.util.List;

/**
 * 产品图片 / 视频。
 *
 * <p>F2 子轨道引入「本地暂存 + 后台 worker 推 R2」生命周期：
 * <ul>
 *   <li>{@code localPath}：上传后立即落本地的临时路径（R2 上传完成后由 worker 清空）</li>
 *   <li>{@code r2Status}：PENDING / UPLOADING / DONE / FAILED；DEFAULT DONE 给历史数据兼容</li>
 *   <li>{@code thumbnailUrl}：视频缩略图（图片不用）</li>
 *   <li>{@code mediaType}：IMAGE / VIDEO</li>
 * </ul>
 */
@TableName(value = "product_image", autoResultMap = true)
public class ProductImage {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long productId;
    private String src;
    private String r2Key;
    private Integer position;
    private String altText;
    private Boolean giftCard;

    /** V30：标签数组（前端校验必填） */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> tags;
    /** V30：备注（选填） */
    private String remark;
    /** V30：本地暂存路径（R2 上传成功后由 worker 清空） */
    private String localPath;
    /** V30：R2 上传状态 PENDING / UPLOADING / DONE / FAILED */
    private String r2Status;
    /** V30：上传失败原因 */
    private String r2Error;
    /** V30：视频缩略图 URL（图片不用） */
    private String thumbnailUrl;
    /** V30：媒体类型 IMAGE / VIDEO */
    private String mediaType;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public String getSrc() { return src; }
    public void setSrc(String src) { this.src = src; }
    public String getR2Key() { return r2Key; }
    public void setR2Key(String r2Key) { this.r2Key = r2Key; }
    public Integer getPosition() { return position; }
    public void setPosition(Integer position) { this.position = position; }
    public String getAltText() { return altText; }
    public void setAltText(String altText) { this.altText = altText; }
    public Boolean getGiftCard() { return giftCard; }
    public void setGiftCard(Boolean giftCard) { this.giftCard = giftCard; }
    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags; }
    public String getRemark() { return remark; }
    public void setRemark(String remark) { this.remark = remark; }
    public String getLocalPath() { return localPath; }
    public void setLocalPath(String localPath) { this.localPath = localPath; }
    public String getR2Status() { return r2Status; }
    public void setR2Status(String r2Status) { this.r2Status = r2Status; }
    public String getR2Error() { return r2Error; }
    public void setR2Error(String r2Error) { this.r2Error = r2Error; }
    public String getThumbnailUrl() { return thumbnailUrl; }
    public void setThumbnailUrl(String thumbnailUrl) { this.thumbnailUrl = thumbnailUrl; }
    public String getMediaType() { return mediaType; }
    public void setMediaType(String mediaType) { this.mediaType = mediaType; }
}
