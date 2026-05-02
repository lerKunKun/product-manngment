package com.biou.shopifyhub.newstore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Saga 上下文，序列化进 task.saga_data_json。
 * 各步骤把自己的输出写到对应字段，下一步从这里读输入。
 */
public record SagaContext(
    Long taskId,
    Long tenantId,
    Long storeId,                 // 新店 store.id（在 AUTH_DONE 步骤填）
    String shopDomain,            // 新店 myshopify_domain
    String shopAccessToken,       // 临时持有，task 完成后清空
    Long templateId,              // base_template.id（W3-TPL）
    Map<String, String> replaceRules,  // domain/brand 替换规则（W3-NEW-07）
    List<Long> productIdsToPush,  // (步骤 PRODUCTS)
    Map<String, Object> stepOutputs   // 各 step 完成后的产物 (collection ids / theme id / etc.)
) {
    public static SagaContext empty(Long taskId, Long tenantId) {
        return new SagaContext(taskId, tenantId, null, null, null, null, Map.of(), List.of(), new LinkedHashMap<>());
    }
}
