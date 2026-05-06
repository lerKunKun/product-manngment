package com.biou.shopifyhub.asset.diff.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * V38: snapshot_diff_cache — 跨店 / 历史快照 diff 结果缓存（AS4）。
 *
 * <p>一对 {@code (snapshotAId, snapshotBId)} + {@code scope} 唯一。命中即直接返回 {@code resultJson}；
 * 未命中由 {@code DiffService.getOrCompute} 现算后写入。当前 scope 取值：
 * <ul>
 *   <li>{@code "manifest"} — 一层 diff（按 relative_path 左外连接，ADDED/REMOVED/MODIFIED）</li>
 *   <li>{@code "content:<path>"} — 内容层按文件路径缓存（粒度：单文件 unified_diff）</li>
 * </ul>
 */
@TableName(value = "snapshot_diff_cache", autoResultMap = true)
public class SnapshotDiffCache {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long snapshotAId;
    private Long snapshotBId;
    private String scope;
    private String resultJson;
    private LocalDateTime computedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getSnapshotAId() { return snapshotAId; }
    public void setSnapshotAId(Long snapshotAId) { this.snapshotAId = snapshotAId; }
    public Long getSnapshotBId() { return snapshotBId; }
    public void setSnapshotBId(Long snapshotBId) { this.snapshotBId = snapshotBId; }
    public String getScope() { return scope; }
    public void setScope(String scope) { this.scope = scope; }
    public String getResultJson() { return resultJson; }
    public void setResultJson(String resultJson) { this.resultJson = resultJson; }
    public LocalDateTime getComputedAt() { return computedAt; }
    public void setComputedAt(LocalDateTime computedAt) { this.computedAt = computedAt; }
}
