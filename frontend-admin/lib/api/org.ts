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
};
