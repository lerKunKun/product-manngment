import { api } from "./client";

export type RecycleItem = Record<string, unknown> & {
  id: number;
  days_left: number | null;
};

export const recycleApi = {
  list: (table: "sys_user" | "user_invitation" | "sys_org") =>
    api.get<RecycleItem[]>(`/recyclebin/${table}`),

  restore: (
    table: "sys_user" | "user_invitation" | "sys_org",
    id: number,
    sensitiveToken: string
  ) =>
    api.post<void>(`/recyclebin/${table}/${id}/restore`, undefined, {
      headers: { "X-Sensitive-Token": sensitiveToken },
    }),

  requestSensitiveCode: (action: string) =>
    api.post<void>("/auth/sensitive/request", { action }),

  verifySensitive: (action: string, code: string) =>
    api.post<{ sensitiveToken: string; ttl: string }>("/auth/sensitive/verify", {
      action,
      code,
    }),
};
