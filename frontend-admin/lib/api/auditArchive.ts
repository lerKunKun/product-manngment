import { api } from "./client";

export type AuditArchiveLog = {
  id: number;
  archiveMonth: string;
  rowCount?: number;
  startId?: number;
  endId?: number;
  r2Bucket?: string;
  r2Key?: string;
  bytesCompressed?: number;
  bytesEncrypted?: number;
  sha256?: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  errorMsg?: string;
  startedAt: string;
  finishedAt?: string;
};

export const auditArchiveApi = {
  // 后端可能没有专门 endpoint；先用占位调用，缺就 fallback EmptyState
  list: () => api.get<AuditArchiveLog[]>(`/admin/audit-archive`, { silent: true }),
};
