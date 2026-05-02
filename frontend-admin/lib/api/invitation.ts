import { api } from "./client";

export type InvitationPreview = {
  email: string;
  companyName: string;
  deptName?: string;
  roleNames: string[];
  accountExpiresAt: string;
  invitedByName?: string;
  invitedAt: string;
};

export type InvitationListItem = {
  id: number;
  email: string;
  status: "PENDING" | "ACCEPTED" | "LINK_EXPIRED" | "REVOKED";
  invitedAt: string;
  accountExpiresAt: string;
  linkExpiresAt: string;
  acceptedAt?: string;
  invitedBy?: number;
  createdUserId?: number;
};

export type InvitationCreateRequest = {
  email: string;
  targetCompanyId: number;
  targetDeptId?: number;
  roleCodes: string[];
  dataScopes: { scopeType: "STORE" | "COMPANY" | "PRODUCT"; scopeId: number; access: "READ" | "WRITE" }[];
  accountExpiresAt: string;
  note?: string;
};

export const invitationApi = {
  preview: (token: string) =>
    api.get<InvitationPreview>(
      `/invitation/preview?token=${encodeURIComponent(token)}`
    ),
  accept: (token: string, tempPassword: string) =>
    api.post<{ userId: number }>("/invitation/accept", { token, tempPassword }),
  list: (status?: string) =>
    api.get<InvitationListItem[]>(
      `/invitation${status ? `?status=${status}` : ""}`
    ),
  create: (req: InvitationCreateRequest) =>
    api.post<{ invitationId: number }>("/invitation/create", req),
  revoke: (id: number, reason?: string) =>
    api.post<void>(
      `/invitation/${id}/revoke${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`
    ),
  revokeUser: (userId: number, reason?: string) =>
    api.post<void>(
      `/invitation/users/${userId}/revoke${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`
    ),
};
