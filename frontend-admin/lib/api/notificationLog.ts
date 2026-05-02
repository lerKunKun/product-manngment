import { api } from "./client";

export type NotificationLog = {
  id: number;
  tenantId?: number;
  userId: number;
  eventCode: string;
  channel: string; // DINGTALK / EMAIL / INAPP
  subject?: string;
  bodyText?: string;
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  errorMsg?: string;
  attemptCount: number;
  nextRetryAt?: string;
  createdAt: string;
  sentAt?: string;
};

export type Page<T> = {
  records: T[];
  total: number;
  size: number;
  current: number;
};

export const notificationLogApi = {
  list: (params: {
    eventCode?: string;
    channel?: string;
    status?: string;
    userId?: number;
    from?: string;
    to?: string;
    page?: number;
    size?: number;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(
      ([k, v]) => v !== undefined && v !== "" && q.set(k, String(v))
    );
    return api.get<Page<NotificationLog>>(
      `/admin/notification-log?${q.toString()}`
    );
  },
  get: (id: number) => api.get<NotificationLog>(`/admin/notification-log/${id}`),
  retry: (id: number) =>
    api.post<boolean>(`/admin/notification-log/${id}/retry`, null),
  stats: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return api.get<Record<string, number>>(
      `/admin/notification-log/stats?${q.toString()}`
    );
  },
};
