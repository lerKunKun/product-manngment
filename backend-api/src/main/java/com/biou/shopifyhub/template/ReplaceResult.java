package com.biou.shopifyhub.template;

import java.util.Map;

/**
 * {@link ReplaceEngine#apply} 返回值：替换后的文本 + 每条规则命中次数。
 *
 * @param text 替换后的字符串
 * @param hits 规则名 → 该规则在原文中匹配到的子串数量。规则未命中时仍出现在 map 里且值为 0。
 */
public record ReplaceResult(String text, Map<String, Integer> hits) {
}
