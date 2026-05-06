package com.biou.shopifyhub.asset.diff.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * 内容层 diff 结果：每个 path 一条 {@link DiffChange}（带 diffPreview）。
 */
public class ContentDiffResult {
    public Long snapshotAId;
    public Long snapshotBId;
    public List<DiffChange> items = new ArrayList<>();
}
