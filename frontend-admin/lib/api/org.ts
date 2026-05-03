import { api } from "./client";

export type SysOrg = {
  id: number;
  parentId?: number;
  name: string;
  code?: string;
  type?: string; // COMPANY / DEPT
  dingtalkDeptId?: number | string;
  status?: string;
  createdAt?: string;
};

export type OrgTreeNode = {
  id: number;
  name: string;
  parentId?: number;
  type?: string;
  dingtalkDeptId?: number | string;
  children?: OrgTreeNode[];
  // 后端 service.tree() 返回 List<Map<String, Object>>，字段以实际为准；
  // 这里给一个兜底类型，渲染时 fallback 到 (it as any).xxx
};

export type DingtalkConfigView = {
  configured: boolean;
  orgId?: number;
  corpId?: string;
  appKey?: string;
  agentId?: string;
  eventToken?: string | null;
  eventAesKey?: string | null;
  status?: string;
  appSecret?: string; // "***" 占位，永远不返回明文
  updatedAt?: string;
};

export type DingtalkConfigInput = {
  corpId: string;
  appKey: string;
  /** 留空表示不更新 secret（仅在新增时必填） */
  appSecret?: string;
  agentId: string;
  eventToken?: string;
  eventAesKey?: string;
  status?: string;
};

export type DingtalkSyncResult = {
  added: number;
  skipped: number;
  failed: number;
  errorMsg?: string | null;
};

export const orgApi = {
  tree: () => api.get<OrgTreeNode[]>(`/org/tree`),
  list: () => api.get<SysOrg[]>(`/org`),
  create: (input: Partial<SysOrg>) => api.post<{ id: number }>(`/org`, input),
  update: (id: number, patch: Partial<SysOrg>) => api.put<void>(`/org/${id}`, patch),
  remove: (id: number, sensitiveToken?: string) =>
    api.del<void>(
      `/org/${id}`,
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),
  // 复用敏感操作
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", { action, code }),

  // F1：组织级钉钉应用配置
  getDingtalkConfig: (orgId: number) =>
    api.get<DingtalkConfigView>(`/org/${orgId}/dingtalk-config`),
  saveDingtalkConfig: (orgId: number, input: DingtalkConfigInput) =>
    api.put<void>(`/org/${orgId}/dingtalk-config`, input),

  // F2 / F3：触发同步
  triggerSync: (orgId: number) =>
    api.post<DingtalkSyncResult>(`/org/${orgId}/sync`),
};
