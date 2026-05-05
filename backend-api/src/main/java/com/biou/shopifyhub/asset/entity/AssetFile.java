package com.biou.shopifyhub.asset.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName(value = "asset_file", autoResultMap = true)
public class AssetFile {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long snapshotId;
    private String relativePath;
    private String r2Key;
    /**
     * CAS blob 引用（{@code asset_blob.sha256}）。
     * 新写入路径会与 {@link #sha256} 同值；老数据保留 NULL，等 follow-up 回填。
     */
    private String blobSha256;
    private Long sizeBytes;
    private String contentType;
    private String sha256;
    private LocalDateTime downloadedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getSnapshotId() { return snapshotId; }
    public void setSnapshotId(Long snapshotId) { this.snapshotId = snapshotId; }
    public String getRelativePath() { return relativePath; }
    public void setRelativePath(String relativePath) { this.relativePath = relativePath; }
    public String getR2Key() { return r2Key; }
    public void setR2Key(String r2Key) { this.r2Key = r2Key; }
    public String getBlobSha256() { return blobSha256; }
    public void setBlobSha256(String blobSha256) { this.blobSha256 = blobSha256; }
    public Long getSizeBytes() { return sizeBytes; }
    public void setSizeBytes(Long sizeBytes) { this.sizeBytes = sizeBytes; }
    public String getContentType() { return contentType; }
    public void setContentType(String contentType) { this.contentType = contentType; }
    public String getSha256() { return sha256; }
    public void setSha256(String sha256) { this.sha256 = sha256; }
    public LocalDateTime getDownloadedAt() { return downloadedAt; }
    public void setDownloadedAt(LocalDateTime downloadedAt) { this.downloadedAt = downloadedAt; }
}
