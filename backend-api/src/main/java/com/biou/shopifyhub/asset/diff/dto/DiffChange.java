package com.biou.shopifyhub.asset.diff.dto;

/**
 * Diff 单条变更记录。manifest 层只填 {@code category/path/kind/shaA/shaB/sizeA/sizeB}；
 * 内容层（worker 回传）会在 {@code diffPreview} 写入 unified diff 文本（最多 50 行）。
 */
public class DiffChange {

    /** 变更类型：ADDED / REMOVED / MODIFIED / UNCHANGED（默认过滤掉 UNCHANGED 不返回） */
    public String kind;

    /**
     * 大类。manifest 层按 relative_path 第一段推断：
     * theme / products / shop_settings / metafields / files / collections / menus / policies / other
     */
    public String category;

    /** manifest 内的相对路径，如 templates/index.json / products/123.json */
    public String path;

    /** 左侧 sha256（REMOVED / MODIFIED 时存在） */
    public String shaA;
    /** 右侧 sha256（ADDED / MODIFIED 时存在） */
    public String shaB;

    public Long sizeA;
    public Long sizeB;

    /** 内容类型（取右侧优先；ADDED 直接给 right.content_type） */
    public String contentType;

    /** 内容层 diff 预览（unified_diff，仅 content scope 才填） */
    public String diffPreview;

    public DiffChange() {}

    public DiffChange(String kind, String category, String path) {
        this.kind = kind;
        this.category = category;
        this.path = path;
    }
}
