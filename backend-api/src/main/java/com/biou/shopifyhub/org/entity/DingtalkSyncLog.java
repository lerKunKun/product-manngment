package com.biou.shopifyhub.org.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 钉钉同步执行日志。每次 syncDepartments / syncUsers / syncAll 都写一条；
 * scope 区分类型，trigger_source 区分谁触发。
 */
@TableName("dingtalk_sync_log")
public class DingtalkSyncLog {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long orgId;
    /** DEPT / USER / ALL */
    private String scope;
    /** CREATE_ORG / MANUAL / SCHEDULED */
    private String triggerSource;
    private Integer added;
    private Integer skipped;
    private Integer failed;
    private String errorMsg;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getOrgId() { return orgId; }
    public void setOrgId(Long orgId) { this.orgId = orgId; }
    public String getScope() { return scope; }
    public void setScope(String scope) { this.scope = scope; }
    public String getTriggerSource() { return triggerSource; }
    public void setTriggerSource(String triggerSource) { this.triggerSource = triggerSource; }
    public Integer getAdded() { return added; }
    public void setAdded(Integer added) { this.added = added; }
    public Integer getSkipped() { return skipped; }
    public void setSkipped(Integer skipped) { this.skipped = skipped; }
    public Integer getFailed() { return failed; }
    public void setFailed(Integer failed) { this.failed = failed; }
    public String getErrorMsg() { return errorMsg; }
    public void setErrorMsg(String errorMsg) { this.errorMsg = errorMsg; }
    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }
    public LocalDateTime getFinishedAt() { return finishedAt; }
    public void setFinishedAt(LocalDateTime finishedAt) { this.finishedAt = finishedAt; }
}
