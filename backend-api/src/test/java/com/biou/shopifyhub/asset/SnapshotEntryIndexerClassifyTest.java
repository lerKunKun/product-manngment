package com.biou.shopifyhub.asset;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * SnapshotEntryIndexer#classify 是 R2 → DB ingest 时给每条 entry 算 category 的纯函数。
 * 规则必须和前端 classify()（app/(authed)/assets/[id]/page.tsx）一致，
 * 改任何一边都要同步另一边。本测试钉住规则。
 */
class SnapshotEntryIndexerClassifyTest {

    @Test
    void theme_dirs_classified_as_theme() {
        assertThat(SnapshotEntryIndexer.classify("sections/header.liquid", null)).isEqualTo("theme");
        assertThat(SnapshotEntryIndexer.classify("snippets/nav.liquid", null)).isEqualTo("theme");
        assertThat(SnapshotEntryIndexer.classify("templates/index.json", null)).isEqualTo("theme");
        assertThat(SnapshotEntryIndexer.classify("config/settings_data.json", null)).isEqualTo("theme");
        assertThat(SnapshotEntryIndexer.classify("locales/zh-CN.json", null)).isEqualTo("theme");
        assertThat(SnapshotEntryIndexer.classify("layout/theme.liquid", null)).isEqualTo("theme");
    }

    @Test
    void theme_assets_code_classified_as_theme_not_image_or_data() {
        assertThat(SnapshotEntryIndexer.classify("assets/theme.css", "text/css")).isEqualTo("theme");
        assertThat(SnapshotEntryIndexer.classify("assets/theme.js", "application/javascript")).isEqualTo("theme");
        assertThat(SnapshotEntryIndexer.classify("assets/theme.scss", null)).isEqualTo("theme");
    }

    @Test
    void images_by_mime_and_extension() {
        assertThat(SnapshotEntryIndexer.classify("assets/logo.png", "image/png")).isEqualTo("image");
        assertThat(SnapshotEntryIndexer.classify("1001.jpg", "image/jpeg")).isEqualTo("image");
        // 仅扩展名也算
        assertThat(SnapshotEntryIndexer.classify("random/file.webp", null)).isEqualTo("image");
        // mime 优先
        assertThat(SnapshotEntryIndexer.classify("unknown", "image/avif")).isEqualTo("image");
    }

    @Test
    void videos_classified_correctly() {
        assertThat(SnapshotEntryIndexer.classify("videos/promo.mp4", "video/mp4")).isEqualTo("video");
        assertThat(SnapshotEntryIndexer.classify("foo.mov", null)).isEqualTo("video");
    }

    @Test
    void fonts_by_mime_or_extension() {
        assertThat(SnapshotEntryIndexer.classify("assets/icon.woff2", "font/woff2")).isEqualTo("font");
        assertThat(SnapshotEntryIndexer.classify("assets/icon.ttf", null)).isEqualTo("font");
        assertThat(SnapshotEntryIndexer.classify("anywhere", "application/font-woff")).isEqualTo("font");
    }

    @Test
    void data_json_only_when_not_theme_dir() {
        assertThat(SnapshotEntryIndexer.classify("product.json", "application/json")).isEqualTo("data");
        assertThat(SnapshotEntryIndexer.classify("shop_settings.json", null)).isEqualTo("data");
        // 但主题目录下的 json 应归 theme（templates/index.json）
        assertThat(SnapshotEntryIndexer.classify("templates/page.contact.json", null)).isEqualTo("theme");
    }

    @Test
    void other_is_fallback() {
        assertThat(SnapshotEntryIndexer.classify("README", null)).isEqualTo("other");
        assertThat(SnapshotEntryIndexer.classify("data.bin", "application/octet-stream")).isEqualTo("other");
    }

    @Test
    void null_safe() {
        assertThat(SnapshotEntryIndexer.classify(null, null)).isEqualTo("other");
        assertThat(SnapshotEntryIndexer.classify("", "")).isEqualTo("other");
    }
}
