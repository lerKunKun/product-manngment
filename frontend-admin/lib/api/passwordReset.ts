import { api } from "./client";

export const passwordResetApi = {
  request: (email: string) =>
    api.post<void>("/auth/password-reset/request", { email }),

  confirm: (token: string, newPassword: string) =>
    api.post<void>("/auth/password-reset/confirm", { token, newPassword }),
};
