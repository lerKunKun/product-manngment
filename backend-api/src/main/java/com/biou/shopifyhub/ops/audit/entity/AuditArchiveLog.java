package com.biou.shopifyhub.ops.audit.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * audit_archive_log 元数据：每月一行，记录 sys_audit_log 月归档的位置 / 校验 / 状态。
 * 见 V24 迁移与 {@link com.biou.shopifyhub.ops.audit.AuditArchiveScheduler}。
 */
@TableName("audit_archive_log")
public class AuditArchiveLog {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 'YYYY-MM' */
    private String archiveMonth;

    private Long rowCount;
    private Long startId;
    private Long endId;
    private String r2Bucket;
    private String r2Key;
    private Long bytesCompressed;
    private Long bytesEncrypted;
    private String sha256;
    private String ivBase64;

    /** RUNNING / SUCCESS / FAILED */
    private String status;

    private String errorMsg;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getArchiveMonth() { return archiveMonth; }
    public void setArchiveMonth(String archiveMonth) { this.archiveMonth = archiveMonth; }
    public Long getRowCount() { return rowCount; }
    public void setRowCount(Long rowCount) { this.rowCount = rowCount; }
    public Long getStartId() { return startId; }
    public void setStartId(Long startId) { this.startId = startId; }
    public Long getEndId() { return endId; }
    public void setEndId(Long endId) { this.endId = endId; }
    public String getR2Bucket() { return r2Bucket; }
    public void setR2Bucket(String r2Bucket) { this.r2Bucket = r2Bucket; }
    public String getR2Key() { return r2Key; }
    public void setR2Key(String r2Key) { this.r2Key = r2Key; }
    public Long getBytesCompressed() { return bytesCompressed; }
    public void setBytesCompressed(Long bytesCompressed) { this.bytesCompressed = bytesCompressed; }
    public Long getBytesEncrypted() { return bytesEncrypted; }
    public void setBytesEncrypted(Long bytesEncrypted) { this.bytesEncrypted = bytesEncrypted; }
    public String getSha256() { return sha256; }
    public void setSha256(String sha256) { this.sha256 = sha256; }
    public String getIvBase64() { return ivBase64; }
    public void setIvBase64(String ivBase64) { this.ivBase64 = ivBase64; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getErrorMsg() { return errorMsg; }
    public void setErrorMsg(String errorMsg) { this.errorMsg = errorMsg; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    public LocalDateTime getFinishedAt() { return finishedAt; }
    public void setFinishedAt(LocalDateTime finishedAt) { this.finishedAt = finishedAt; }
}
