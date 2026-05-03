/**
 * 权限码中英文描述字典。
 *
 * 数据来源：`backend-api/src/main/resources/db/migration/V2__init_rbac_seed.sql`
 *
 * 维护约定：
 *   - 后端新增 sys_permission 种子时，**必须**同步在此文件登记，否则前端权限矩阵只会显示 code（fallback）。
 *   - 不要在此文件中编造后端尚未存在的 code。
 *   - module 字段用于在权限矩阵 UI 中按模块分组；新模块同步加到 `PERMISSION_MODULES`。
 */

export type PermissionMeta = {
  /** 中文描述 */
  zh: string;
  /** 英文描述 */
  en: string;
  /** 所属模块 key（与 PERMISSION_MODULES 对应） */
  module: string;
};

/**
 * 权限码 → {zh, en, module}。
 * 完整覆盖 V2__init_rbac_seed.sql 中的 23 个 sys_permission 种子。
 */
export const PERMISSION_META: Record<string, PermissionMeta> = {
  // ===== 产品 =====
  "PRODUCT:READ": { zh: "查看产品", en: "View product", module: "product" },
  "PRODUCT:WRITE": { zh: "编辑产品", en: "Edit product", module: "product" },
  "PRODUCT:PUSH": { zh: "推送产品", en: "Push product", module: "product" },
  "PRODUCT:DELETE": { zh: "删除产品", en: "Delete product", module: "product" },

  // ===== 店铺 =====
  "STORE:READ": { zh: "查看店铺", en: "View store", module: "store" },
  "STORE:TOKEN_MANAGE": {
    zh: "管理 Shopify Token",
    en: "Manage Shopify token",
    module: "store",
  },
  "STORE:OAUTH": {
    zh: "接入店铺 OAuth",
    en: "Connect store via OAuth",
    module: "store",
  },

  // ===== 采购 =====
  "PURCHASE:READ": {
    zh: "查看采购信息",
    en: "View purchase info",
    module: "purchase",
  },
  "PURCHASE:SKU_EDIT": {
    zh: "改 SKU（需二次确认）",
    en: "Edit SKU (requires step-up)",
    module: "purchase",
  },

  // ===== 媒体 =====
  "MEDIA:UPLOAD": { zh: "上传媒体", en: "Upload media", module: "media" },
  "MEDIA:DELETE": { zh: "删除媒体", en: "Delete media", module: "media" },

  // ===== 主题 =====
  "THEME:DEPLOY": { zh: "部署主题", en: "Deploy theme", module: "theme" },
  "THEME:PULL": { zh: "拉取主题快照", en: "Pull theme snapshot", module: "theme" },

  // ===== 审批 =====
  "APPROVAL:DECIDE": {
    zh: "审批决策",
    en: "Decide on approval",
    module: "approval",
  },
  "APPROVAL:SUBMIT": {
    zh: "提交审批",
    en: "Submit approval",
    module: "approval",
  },

  // ===== 临时员工邀请 =====
  "TEMP_USER:INVITE": {
    zh: "发起临时员工邀请",
    en: "Invite temporary staff",
    module: "temp_user",
  },
  "TEMP_USER:REVOKE": {
    zh: "撤销邀请或注销临时账号",
    en: "Revoke invitation or temp account",
    module: "temp_user",
  },
  "TEMP_USER:LIST": {
    zh: "查看临时员工列表",
    en: "View temporary staff list",
    module: "temp_user",
  },

  // ===== 回收站 =====
  "RECYCLE_BIN:VIEW": {
    zh: "查看回收站",
    en: "View recycle bin",
    module: "recycle",
  },
  "RECYCLE_BIN:RESTORE": {
    zh: "恢复软删除项",
    en: "Restore soft-deleted items",
    module: "recycle",
  },

  // ===== 平台（仅平台超管）=====
  "PLATFORM:TENANT_MANAGE": {
    zh: "租户管理",
    en: "Manage tenants",
    module: "platform",
  },
  "PLATFORM:TEMPLATE_MANAGE": {
    zh: "模板库管理",
    en: "Manage template library",
    module: "platform",
  },
  "PLATFORM:DINGTALK_CONFIG": {
    zh: "钉钉企业配置",
    en: "DingTalk corp config",
    module: "platform",
  },
};

/** 模块 key → 中英文显示名。控制权限矩阵分组顺序（对象插入顺序）。 */
export const PERMISSION_MODULES: Record<string, { zh: string; en: string }> = {
  product: { zh: "产品库", en: "Product" },
  store: { zh: "店铺", en: "Store" },
  purchase: { zh: "采购", en: "Purchase" },
  media: { zh: "媒体", en: "Media" },
  theme: { zh: "主题", en: "Theme" },
  approval: { zh: "审批", en: "Approval" },
  temp_user: { zh: "临时员工", en: "Temporary staff" },
  recycle: { zh: "回收站", en: "Recycle bin" },
  platform: { zh: "平台管理", en: "Platform" },
};

export type PermLang = "zh" | "en";

/** 获取权限码的本地化描述；未登记直接返回 code。 */
export function permissionLabel(code: string, lang: PermLang = "zh"): string {
  const meta = PERMISSION_META[code];
  if (!meta) return code;
  return lang === "zh" ? meta.zh : meta.en;
}

/** 获取权限码所属模块 key；未登记落到 "_other"（UI 兜底分组）。 */
export function permissionModule(code: string): string {
  return PERMISSION_META[code]?.module ?? "_other";
}

/** 获取模块的本地化标签；未登记返回 module key。 */
export function moduleLabel(module: string, lang: PermLang = "zh"): string {
  const meta = PERMISSION_MODULES[module];
  if (!meta) return module;
  return lang === "zh" ? meta.zh : meta.en;
}

/** 全部已登记的 permission code 列表（按 PERMISSION_META 对象顺序）。 */
export const ALL_PERMISSION_CODES: string[] = Object.keys(PERMISSION_META);
