package com.biou.shopifyhub.asset.diff.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * Manifest 一层 diff 结果：summary + 过滤掉 UNCHANGED 之后的变更列表。
 */
public class ManifestDiffResult {
    public DiffSummary summary;
    public List<DiffChange> changes = new ArrayList<>();
    /** 命中缓存与否（前端 dev 调试用） */
    public boolean cached;
}
