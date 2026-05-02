import { api } from "./client";

export type SysAuditLog = {
  id: number;
  userId?: number;
  username?: string;
  employeeNo?: string;
  orgId?: number;
  tenantId?: number;
  module?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  requestMethod?: string;
  requestUri?: string;
  requestPayload?: string;
  responseStatus?: number;
  ip?: string;
  userAgent?: string;
  sensitive?: boolean;
  createdAt: string;
};

export type Page<T> = {
  records: T[];
  total: number;
  size: number;
  current: number;
};

export const auditLogApi = {
  list: (params: {
    userId?: number;
    module?: string;
    action?: string;
    sensitive?: boolean;
    from?: string;
    to?: string;
    page?: number;
    size?: number;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(
      ([k, v]) => v !== undefined && v !== "" && q.set(k, String(v))
    );
    return api.get<Page<SysAuditLog>>(`/admin/audit-log?${q.toString()}`);
  },
  get: (id: number) => api.get<SysAuditLog>(`/admin/audit-log/${id}`),
  /** T19: 后端流式 CSV 导出；返回完整 URL（含 /api 前缀），供 window.open 直接下载。 */
  exportUrl: (params: {
    userId?: number;
    module?: string;
    action?: string;
    sensitive?: boolean;
    from?: string;
    to?: string;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(
      ([k, v]) => v !== undefined && v !== "" && q.set(k, String(v))
    );
    return `/api/admin/audit-log/export?${q.toString()}`;
  },
};
