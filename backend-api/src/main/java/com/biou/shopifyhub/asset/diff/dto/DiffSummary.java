package com.biou.shopifyhub.asset.diff.dto;

/**
 * Diff 汇总：四类计数 + 入参快照 id。前端 summary 卡片用。
 */
public class DiffSummary {
    public Long snapshotAId;
    public Long snapshotBId;
    public int added;
    public int removed;
    public int modified;
    public int unchanged;

    public DiffSummary() {}

    public DiffSummary(Long a, Long b) {
        this.snapshotAId = a;
        this.snapshotBId = b;
    }
}
