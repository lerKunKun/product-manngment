package com.biou.shopifyhub.template.binding;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.biou.shopifyhub.core.ResultCode;
import com.biou.shopifyhub.core.exception.BusinessException;
import com.biou.shopifyhub.template.RuleSpec;
import com.biou.shopifyhub.template.entity.BaseTemplateVersion;
import com.biou.shopifyhub.template.mapper.BaseTemplateVersionMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 店铺-模板版本绑定（Track AS5）。
 *
 * <p>解析 + 合并替换规则：{@code base_template_version.default_replace_rules_json}
 * 为基线，{@code store_template_binding.custom_replace_rules_json} 同 key 覆盖。
 */
@Service
public class StoreTemplateBindingService {

    private static final Logger log = LoggerFactory.getLogger(StoreTemplateBindingService.class);

    private final StoreTemplateBindingMapper bindingMapper;
    private final BaseTemplateVersionMapper versionMapper;
    private final ObjectMapper objectMapper;

    public StoreTemplateBindingService(StoreTemplateBindingMapper bindingMapper,
                                       BaseTemplateVersionMapper versionMapper,
                                       ObjectMapper objectMapper) {
        this.bindingMapper = bindingMapper;
        this.versionMapper = versionMapper;
        this.objectMapper = objectMapper;
    }

    /**
     * 取该店当前 binding；不存在返回 {@code null}。
     */
    public StoreTemplateBinding getOrEmpty(long storeId) {
        return bindingMapper.selectOne(new LambdaQueryWrapper<StoreTemplateBinding>()
            .eq(StoreTemplateBinding::getStoreId, storeId));
    }

    /**
     * 绑定/重绑该店到指定 base_template_version。已有则覆写，没有则插入。
     *
     * @param customReplaceRulesJson 可选自定义规则 JSON；null 或空表示用模板默认值即可。
     */
    public void bind(long storeId, long baseTemplateVersionId, String customReplaceRulesJson, Long actorUserId) {
        BaseTemplateVersion v = versionMapper.selectById(baseTemplateVersionId);
        if (v == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "base_template_version not found: " + baseTemplateVersionId);
        }
        StoreTemplateBinding existing = getOrEmpty(storeId);
        LocalDateTime now = LocalDateTime.now();
        if (existing == null) {
            StoreTemplateBinding row = new StoreTemplateBinding();
            row.setStoreId(storeId);
            row.setBaseTemplateVersionId(baseTemplateVersionId);
            row.setCustomReplaceRulesJson(blankToNull(customReplaceRulesJson));
            row.setBoundAt(now);
            row.setBoundBy(actorUserId);
            bindingMapper.insert(row);
            log.info("[store-template-binding] bound storeId={} versionId={} by={}", storeId, baseTemplateVersionId, actorUserId);
        } else {
            existing.setBaseTemplateVersionId(baseTemplateVersionId);
            existing.setCustomReplaceRulesJson(blankToNull(customReplaceRulesJson));
            existing.setBoundAt(now);
            existing.setBoundBy(actorUserId);
            bindingMapper.updateById(existing);
            log.info("[store-template-binding] rebound storeId={} versionId={} by={}", storeId, baseTemplateVersionId, actorUserId);
        }
    }

    public void unbind(long storeId) {
        StoreTemplateBinding existing = getOrEmpty(storeId);
        if (existing == null) return;
        bindingMapper.deleteById(existing.getId());
        log.info("[store-template-binding] unbound storeId={}", storeId);
    }

    /**
     * 取已合并的替换规则。优先级：custom 同 key 覆盖 default。
     *
     * @param baseTemplateVersionId 必填
     * @param customRulesJson       binding 上的自定义 JSON；可为 null
     * @return 规则 map（永远非 null，可能为空）
     */
    public Map<String, RuleSpec> resolveMergedRules(long baseTemplateVersionId, String customRulesJson) {
        BaseTemplateVersion v = versionMapper.selectById(baseTemplateVersionId);
        Map<String, RuleSpec> merged = new LinkedHashMap<>();
        if (v != null) {
            merged.putAll(parseRules(v.getDefaultReplaceRulesJson()));
        }
        merged.putAll(parseRules(customRulesJson));
        return merged;
    }

    /**
     * Pure-JSON parse helper. Accepts the schema
     * {@code {"<rule_name>":{"from":"...","to":"..."}}}; ignores entries that
     * miss either key. Never throws on malformed input — returns empty map and
     * logs a WARN, so a single bad config row can't break a whole push.
     */
    @SuppressWarnings("unchecked")
    public Map<String, RuleSpec> parseRules(String json) {
        Map<String, RuleSpec> out = new LinkedHashMap<>();
        if (json == null || json.isBlank()) return out;
        try {
            Map<String, Object> raw = objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
            for (Map.Entry<String, Object> e : raw.entrySet()) {
                if (!(e.getValue() instanceof Map<?, ?> m)) continue;
                Object from = m.get("from");
                Object to = m.get("to");
                if (from == null) continue;
                out.put(e.getKey(), new RuleSpec(String.valueOf(from), to == null ? "" : String.valueOf(to)));
            }
        } catch (Exception ex) {
            log.warn("[store-template-binding] parseRules failed json='{}' err={}", truncate(json), ex.getMessage());
        }
        return out;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    private static String truncate(String s) {
        if (s == null) return null;
        return s.length() <= 200 ? s : s.substring(0, 200) + "...";
    }
}
