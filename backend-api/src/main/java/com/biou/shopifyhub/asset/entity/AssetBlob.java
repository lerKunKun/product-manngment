package com.biou.shopifyhub.asset.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 资产 CAS（content-addressable storage）blob 元数据。
 *
 * <p>对应表 {@code asset_blob}（V36）。一行 = 一份去重后的字节，物理 key 落在
 * {@code tenants/{tenant_id}/cas/{sha256[:2]}/{sha256}}。多个 {@link AssetFile}
 * 通过 {@code blob_sha256} 列引用同一行实现去重。
 *
 * <p>引用计数 {@code refCount} 当前由 follow-up 任务维护；worker 写入路径只负责
 * 首次插入和 size/content_type 元数据，不会主动 ++/--。
 */
@TableName(value = "asset_blob", autoResultMap = true)
public class AssetBlob {
    /** SHA-256 hex digest，主键。 */
    @TableId(type = IdType.INPUT)
    private String sha256;

    private Long sizeBytes;
    private String contentType;
    private Long tenantId;
    private LocalDateTime firstSeenAt;
    private Integer refCount;

    public String getSha256() { return sha256; }
    public void setSha256(String sha256) { this.sha256 = sha256; }
    public Long getSizeBytes() { return sizeBytes; }
    public void setSizeBytes(Long sizeBytes) { this.sizeBytes = sizeBytes; }
    public String getContentType() { return contentType; }
    public void setContentType(String contentType) { this.contentType = contentType; }
    public Long getTenantId() { return tenantId; }
    public void setTenantId(Long tenantId) { this.tenantId = tenantId; }
    public LocalDateTime getFirstSeenAt() { return firstSeenAt; }
    public void setFirstSeenAt(LocalDateTime firstSeenAt) { this.firstSeenAt = firstSeenAt; }
    public Integer getRefCount() { return refCount; }
    public void setRefCount(Integer refCount) { this.refCount = refCount; }
}
