package com.biou.shopifyhub.template;

/**
 * 单条占位符替换规则（Track AS5）。
 *
 * <p>对应 base_template_version.default_replace_rules_json 中一个条目，例如：
 * <pre>"shop_name": {"from": "BIOU", "to": "{{brand}}"}</pre>
 *
 * <p>{@code from} / {@code to} 都是字面量字符串。{@link ReplaceEngine} 故意
 * 不支持正则，避免误伤产品文案里的特殊字符。
 *
 * @param from 被替换的字面值
 * @param to   替换后的字面值（可包含 Shopify 主题占位符 {{...}}，引擎不解析）
 */
public record RuleSpec(String from, String to) {
}
