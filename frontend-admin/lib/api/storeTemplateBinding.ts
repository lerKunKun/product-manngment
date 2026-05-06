import { api } from "./client";

/**
 * 店铺-模板版本绑定 API（Track AS5）。
 *
 * <p>一店一行；用于跨店推送时拉取该店应用的占位符替换规则。
 * GET 返回 null 表示未绑定（前端渲染空态 / 兜底用模板默认）。
 */
export type StoreTemplateBinding = {
  id: number;
  storeId: number;
  baseTemplateVersionId: number;
  customReplaceRulesJson: string | null;
  boundAt: string;
  boundBy: number | null;
};

export const storeTemplateBindingApi = {
  /** 拿当前 binding；后端返回 null 表示该店未绑定。 */
  get: (storeId: number) =>
    api.get<StoreTemplateBinding | null>(`/store-template-binding/${storeId}`),

  /** 绑定/重绑该店到指定 base_template_version。 */
  upsert: (
    storeId: number,
    body: {
      baseTemplateVersionId: number;
      /** 可选自定义规则 JSON 字符串（同 key 覆盖模板默认） */
      customReplaceRulesJson?: string | null;
    },
  ) => api.put<void>(`/store-template-binding/${storeId}`, body),

  /** 解绑（删除该行）。 */
  remove: (storeId: number) =>
    api.del<void>(`/store-template-binding/${storeId}`),
};
