import { api } from "./client";

/**
 * W4-NTF 通知订阅 API（对应 backend SubscriptionController @ /notification）。
 */
export type NotificationEventDef = {
  code: string;
  name: string;
  category: string; // INVITATION / STORE / PUSH / APPROVAL / SYSTEM / OPS
  defaultChannels: string; // CSV: DINGTALK,EMAIL,INAPP
  defaultSubscribed: boolean;
  description?: string;
  createdAt?: string;
};

export type NotificationSubscription = {
  id?: number; // 未持久化时为空
  userId: number;
  eventCode: string;
  channels: string; // CSV
  enabled: boolean;
  updatedAt?: string;
};

export const notificationApi = {
  listEvents: () => api.get<Record<string, NotificationEventDef[]>>("/notification/events"),
  getMySubscriptions: () => api.get<NotificationSubscription[]>("/notification/subscriptions/me"),
  updateMySubscriptions: (list: NotificationSubscription[]) =>
    api.put<void>("/notification/subscriptions/me", list),
};

export const CATEGORY_LABEL: Record<string, string> = {
  INVITATION: "邀请",
  STORE: "店铺",
  PUSH: "推送",
  APPROVAL: "审批",
  OPS: "运维",
  SYSTEM: "系统",
};

export const CHANNELS = ["DINGTALK", "EMAIL", "INAPP"] as const;
export const CHANNEL_LABEL: Record<string, string> = {
  DINGTALK: "钉钉",
  EMAIL: "邮件",
  INAPP: "站内信",
};
