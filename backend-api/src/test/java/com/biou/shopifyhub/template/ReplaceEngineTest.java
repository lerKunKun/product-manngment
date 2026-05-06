package com.biou.shopifyhub.template;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 占位符替换引擎单测（Track AS5）。
 *
 * <p>覆盖：空规则 / 单条规则 / 多条规则按字典序 / from 不存在不变更 /
 * 命中计数 / null 文本 / 异常 from 防御 / accumulating 累加。
 */
class ReplaceEngineTest {

    @Test
    void apply_with_null_rules_returns_input_unchanged() {
        ReplaceResult r = ReplaceEngine.apply("hello BIOU", null);
        assertEquals("hello BIOU", r.text());
        assertTrue(r.hits().isEmpty());
    }

    @Test
    void apply_with_empty_rules_returns_input_unchanged() {
        ReplaceResult r = ReplaceEngine.apply("hello BIOU", Map.of());
        assertEquals("hello BIOU", r.text());
        assertTrue(r.hits().isEmpty());
    }

    @Test
    void apply_single_rule_replaces_and_counts() {
        Map<String, RuleSpec> rules = Map.of(
            "shop_name", new RuleSpec("BIOU", "{{brand}}")
        );
        ReplaceResult r = ReplaceEngine.apply("BIOU is great. visit BIOU.", rules);
        assertEquals("{{brand}} is great. visit {{brand}}.", r.text());
        assertEquals(2, r.hits().get("shop_name"));
    }

    @Test
    void apply_multiple_rules_sorted_by_key() {
        // 'a_brand' processed before 'z_domain' alphabetically: ensures deterministic order
        Map<String, RuleSpec> rules = new LinkedHashMap<>();
        // intentional non-alpha insertion order
        rules.put("z_domain", new RuleSpec("biou.com", "{{custom_domain}}"));
        rules.put("a_brand", new RuleSpec("BIOU", "{{brand}}"));

        ReplaceResult r = ReplaceEngine.apply("Visit BIOU at biou.com today", rules);
        assertEquals("Visit {{brand}} at {{custom_domain}} today", r.text());
        assertEquals(1, r.hits().get("a_brand"));
        assertEquals(1, r.hits().get("z_domain"));
    }

    @Test
    void apply_rule_with_no_match_leaves_text_unchanged_and_records_zero() {
        Map<String, RuleSpec> rules = Map.of(
            "shop_name", new RuleSpec("ACME", "{{brand}}")
        );
        ReplaceResult r = ReplaceEngine.apply("hello world", rules);
        assertEquals("hello world", r.text());
        assertEquals(0, r.hits().get("shop_name"));
    }

    @Test
    void apply_with_null_text_returns_null_with_zero_hits() {
        Map<String, RuleSpec> rules = Map.of(
            "shop_name", new RuleSpec("BIOU", "{{brand}}")
        );
        ReplaceResult r = ReplaceEngine.apply(null, rules);
        assertNull(r.text());
        assertEquals(0, r.hits().get("shop_name"));
    }

    @Test
    void apply_handles_empty_from_safely() {
        // Defensive: a malformed rule with empty `from` must NOT explode the engine
        Map<String, RuleSpec> rules = Map.of(
            "bad", new RuleSpec("", "X"),
            "good", new RuleSpec("BIOU", "{{brand}}")
        );
        ReplaceResult r = ReplaceEngine.apply("BIOU shop", rules);
        assertEquals("{{brand}} shop", r.text());
        assertEquals(1, r.hits().get("good"));
    }

    @Test
    void apply_does_not_recurse_when_to_contains_from() {
        // `to` contains `from` — naive loop would explode; we use String.replace which
        // walks the original once, so the result is well-defined.
        Map<String, RuleSpec> rules = Map.of(
            "shop_name", new RuleSpec("BIOU", "BIOU-Studio")
        );
        ReplaceResult r = ReplaceEngine.apply("Welcome to BIOU", rules);
        assertEquals("Welcome to BIOU-Studio", r.text());
        assertEquals(1, r.hits().get("shop_name"));
    }

    @Test
    void applyAccumulating_aggregates_hits_across_calls() {
        Map<String, RuleSpec> rules = Map.of(
            "shop_name", new RuleSpec("BIOU", "{{brand}}"),
            "domain", new RuleSpec("biou.com", "{{custom_domain}}")
        );
        Map<String, Integer> totals = new HashMap<>();
        String t1 = ReplaceEngine.applyAccumulating("BIOU shop, biou.com", rules, totals);
        String t2 = ReplaceEngine.applyAccumulating("Just BIOU", rules, totals);
        assertEquals("{{brand}} shop, {{custom_domain}}", t1);
        assertEquals("Just {{brand}}", t2);
        assertEquals(2, totals.get("shop_name"));
        assertEquals(1, totals.get("domain"));
    }
}
