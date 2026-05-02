import { api } from "./client";

export type InappMessage = {
  id: number;
  tenantId?: number;
  userId: number;
  eventCode: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  linkUrl?: string;
  readAt?: string | null;
  createdAt: string;
};

export type InappListResp = {
  items: InappMessage[];
  total: number;
  page: number;
  size: number;
};

export const inboxApi = {
  list: (params: { unreadOnly?: boolean; page?: number; size?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.unreadOnly) q.set("unreadOnly", "true");
    if (params.page) q.set("page", String(params.page));
    if (params.size) q.set("size", String(params.size));
    const s = q.toString();
    return api.get<InappListResp>(`/notification/inapp${s ? `?${s}` : ""}`);
  },

  unreadCount: () => api.get<{ count: number }>("/notification/inapp/unread-count"),

  markRead: (id: number) => api.post<void>(`/notification/inapp/${id}/read`),

  markAllRead: () => api.post<{ updated: number }>("/notification/inapp/read-all"),
};
