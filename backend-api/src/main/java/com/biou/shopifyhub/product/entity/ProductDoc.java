package com.biou.shopifyhub.product.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;

import java.time.LocalDateTime;
import java.util.List;

@TableName(value = "product_doc", autoResultMap = true)
public class ProductDoc {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long productId;
    /** RICH_TEXT / FILE */
    private String type;
    private String richTextJson;
    private String fileR2Key;
    private String fileUrl;
    private String fileName;
    private Long fileSize;
    private String fileMime;
    private String title;
    private Integer sort;
    private Long createdBy;

    /** V30：标签数组（前端校验必填） */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> tags;
    /** V30：备注 */
    private String remark;
    /** V30：本地暂存路径 */
    private String localPath;
    /** V30：R2 上传状态 */
    private String r2Status;
    /** V30：上传失败原因 */
    private String r2Error;
    /** V30：office 病毒扫描状态（占位） */
    private String scanStatus;

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
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getRichTextJson() { return richTextJson; }
    public void setRichTextJson(String richTextJson) { this.richTextJson = richTextJson; }
    public String getFileR2Key() { return fileR2Key; }
    public void setFileR2Key(String fileR2Key) { this.fileR2Key = fileR2Key; }
    public String getFileUrl() { return fileUrl; }
    public void setFileUrl(String fileUrl) { this.fileUrl = fileUrl; }
    public String getFileName() { return fileName; }
    public void setFileName(String fileName) { this.fileName = fileName; }
    public Long getFileSize() { return fileSize; }
    public void setFileSize(Long fileSize) { this.fileSize = fileSize; }
    public String getFileMime() { return fileMime; }
    public void setFileMime(String fileMime) { this.fileMime = fileMime; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public Integer getSort() { return sort; }
    public void setSort(Integer sort) { this.sort = sort; }
    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }
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
    public String getScanStatus() { return scanStatus; }
    public void setScanStatus(String scanStatus) { this.scanStatus = scanStatus; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
    public LocalDateTime getDeletedAt() { return deletedAt; }
    public void setDeletedAt(LocalDateTime deletedAt) { this.deletedAt = deletedAt; }
}
