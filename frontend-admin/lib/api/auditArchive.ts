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

export type BackupStatus = {
  backupLastSuccessSeconds?: number;
  archiveLastSuccessSeconds?: number;
  archiveFailedCount7d: number;
  backupFailedCount7d: number;
};

export type DownloadResp = {
  url: string;
  expiresIn: number;
  sha256?: string;
  archiveMonth: string;
  bytesEncrypted?: number;
};

export const auditArchiveApi = {
  list: (params?: { from?: string; to?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return api.get<AuditArchiveLog[]>(`/admin/audit-archive${qs ? `?${qs}` : ""}`);
  },
  download: (id: number) =>
    api.get<DownloadResp>(`/admin/audit-archive/${id}/download`),
  backupStatus: () => api.get<BackupStatus>(`/admin/ops/backup-status`),
  runArchive: (month: string, sensitiveToken?: string) =>
    api.post<AuditArchiveLog>(
      `/admin/audit-archive/run`,
      { month },
      sensitiveToken ? { headers: { "X-Sensitive-Token": sensitiveToken } } : undefined
    ),
  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),
  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", {
      action,
      code,
    }),
};
