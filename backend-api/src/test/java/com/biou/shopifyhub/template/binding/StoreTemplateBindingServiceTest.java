package com.biou.shopifyhub.template.binding;

import com.biou.shopifyhub.template.RuleSpec;
import com.biou.shopifyhub.template.entity.BaseTemplateVersion;
import com.biou.shopifyhub.template.mapper.BaseTemplateVersionMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 单测：覆盖 parseRules 的健壮性 + resolveMergedRules 的合并优先级。
 *
 * <p>避免 SpringBootTest 拉起完整容器（需要 MySQL/Redis），只用 Mockito 桩出
 * BaseTemplateVersionMapper、StoreTemplateBindingMapper 即可。
 */
class StoreTemplateBindingServiceTest {

    private StoreTemplateBindingMapper bindingMapper;
    private BaseTemplateVersionMapper versionMapper;
    private StoreTemplateBindingService service;

    @BeforeEach
    void setUp() {
        bindingMapper = Mockito.mock(StoreTemplateBindingMapper.class);
        versionMapper = Mockito.mock(BaseTemplateVersionMapper.class);
        service = new StoreTemplateBindingService(bindingMapper, versionMapper, new ObjectMapper());
    }

    @Test
    void parseRules_returns_empty_for_blank_input() {
        assertTrue(service.parseRules(null).isEmpty());
        assertTrue(service.parseRules("").isEmpty());
        assertTrue(service.parseRules("   ").isEmpty());
    }

    @Test
    void parseRules_handles_malformed_json_without_throwing() {
        // a single bad config row must NEVER blow up a whole push
        Map<String, RuleSpec> rules = service.parseRules("not-valid-json{{{");
        assertNotNull(rules);
        assertTrue(rules.isEmpty());
    }

    @Test
    void parseRules_skips_entries_missing_from() {
        String json = "{\"good\":{\"from\":\"BIOU\",\"to\":\"{{brand}}\"},"
            + "\"missing_from\":{\"to\":\"X\"}}";
        Map<String, RuleSpec> rules = service.parseRules(json);
        assertEquals(1, rules.size());
        assertEquals("BIOU", rules.get("good").from());
    }

    @Test
    void parseRules_treats_null_to_as_empty_string() {
        String json = "{\"strip\":{\"from\":\"BIOU\"}}";
        Map<String, RuleSpec> rules = service.parseRules(json);
        assertEquals(1, rules.size());
        assertEquals("", rules.get("strip").to());
    }

    @Test
    void resolveMergedRules_merges_default_then_custom_with_custom_winning() {
        BaseTemplateVersion v = new BaseTemplateVersion();
        v.setId(7L);
        v.setDefaultReplaceRulesJson(
            "{\"shop_name\":{\"from\":\"BIOU\",\"to\":\"{{brand}}\"},"
                + "\"domain\":{\"from\":\"biou.com\",\"to\":\"{{custom_domain}}\"}}"
        );
        Mockito.when(versionMapper.selectById(7L)).thenReturn(v);

        // custom overrides shop_name and adds extra
        String custom = "{\"shop_name\":{\"from\":\"BIOU\",\"to\":\"BrandX\"},"
            + "\"extra\":{\"from\":\"foo\",\"to\":\"bar\"}}";

        Map<String, RuleSpec> merged = service.resolveMergedRules(7L, custom);

        assertEquals(3, merged.size());
        // custom WON for shop_name
        assertEquals("BrandX", merged.get("shop_name").to());
        // default kept for domain (custom didn't override it)
        assertEquals("{{custom_domain}}", merged.get("domain").to());
        // custom-only rule preserved
        assertEquals("bar", merged.get("extra").to());
    }

    @Test
    void resolveMergedRules_with_unknown_version_returns_only_custom() {
        Mockito.when(versionMapper.selectById(99L)).thenReturn(null);
        String custom = "{\"only\":{\"from\":\"x\",\"to\":\"y\"}}";

        Map<String, RuleSpec> merged = service.resolveMergedRules(99L, custom);
        assertEquals(1, merged.size());
        assertEquals("y", merged.get("only").to());
    }
}
