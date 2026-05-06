package com.biou.shopifyhub.template;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * 跨店推送占位符替换引擎（Track AS5）。
 *
 * <p>把诸如 {@code {"shop_name":{"from":"BIOU","to":"{{brand}}"}}} 这样的规则
 * 表应用到一段文本（{@code body_html} / {@code seo_description} / {@code metafield.value}
 * 等）上，每条规则做<strong>字面量替换</strong>（{@link String#replace(CharSequence, CharSequence)}）；
 * 故意不走正则，避免文案里的 {@code .} / {@code (} 之类被当成 metachar。
 *
 * <p>同时统计每条规则在原文里的命中次数（替换前的 substring 计数），便于
 * push 任务在 result_json 里展示 / 审计。
 *
 * <p>规则按 key 字典序应用，保证可重现：同样的 (text, rules) 永远产出同样
 * 的字符串与同样的命中分布。
 */
public final class ReplaceEngine {

    private ReplaceEngine() {
    }

    /**
     * 把规则集应用到一段文本。
     *
     * @param text  原文。{@code null} 直接原样返回 {@link ReplaceResult}（hits 全 0）。
     * @param rules 规则名 → {@link RuleSpec}。{@code null} 或空则不做任何替换。
     * @return 包含替换后文本和每条规则命中次数的结果对象。
     */
    public static ReplaceResult apply(String text, Map<String, RuleSpec> rules) {
        Map<String, Integer> hits = new LinkedHashMap<>();
        if (rules == null || rules.isEmpty()) {
            return new ReplaceResult(text, hits);
        }
        // 字典序遍历：避免规则顺序漂移导致同一输入跑出不同结果
        Map<String, RuleSpec> sorted = new TreeMap<>(rules);
        for (Map.Entry<String, RuleSpec> e : sorted.entrySet()) {
            hits.put(e.getKey(), 0);
        }
        if (text == null) {
            return new ReplaceResult(null, hits);
        }
        String current = text;
        for (Map.Entry<String, RuleSpec> e : sorted.entrySet()) {
            RuleSpec spec = e.getValue();
            if (spec == null || spec.from() == null || spec.from().isEmpty()) {
                continue;
            }
            int count = countOccurrences(current, spec.from());
            hits.put(e.getKey(), count);
            if (count > 0) {
                String to = spec.to() == null ? "" : spec.to();
                current = current.replace(spec.from(), to);
            }
        }
        return new ReplaceResult(current, hits);
    }

    /**
     * 把多条文本依次走 {@link #apply}，把命中次数<strong>累加</strong>到同一个 map。
     * 用于一个 product 的多个字段（title / body_html / seo_description / metafield value 等）
     * 共享一份命中统计。
     */
    public static String applyAccumulating(String text,
                                           Map<String, RuleSpec> rules,
                                           Map<String, Integer> totalHits) {
        ReplaceResult r = apply(text, rules);
        for (Map.Entry<String, Integer> h : r.hits().entrySet()) {
            totalHits.merge(h.getKey(), h.getValue(), Integer::sum);
        }
        return r.text();
    }

    private static int countOccurrences(String haystack, String needle) {
        if (haystack == null || needle == null || needle.isEmpty()) {
            return 0;
        }
        int count = 0;
        int idx = 0;
        while ((idx = haystack.indexOf(needle, idx)) != -1) {
            count++;
            idx += needle.length();
        }
        return count;
    }
}
