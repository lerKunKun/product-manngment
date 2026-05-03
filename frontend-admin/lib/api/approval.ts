import { api } from "./client";

/**
 * W4-APP 审批中心 API（对应 backend ApprovalController @ /approval）。
 */
export type ApprovalFlow = {
  id: number;
  tenantId?: number;
  type: string; // PRODUCT_ACCESS / CROSS_COMPANY_AUTH / ...
  applicantId: number;
  targetUserId?: number;
  payload: Record<string, unknown>;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "RESUBMITTED";
  currentApproverId?: number;
  currentApproverRole?: string;
  decidedBy?: number;
  decidedAt?: string;
  decisionComment?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalLog = {
  id: number;
  flowId: number;
  actorId: number;
  action: "SUBMIT" | "APPROVE" | "REJECT" | "RESUBMIT" | "CANCEL";
  comment?: string;
  payloadSnapshot?: Record<string, unknown>;
  createdAt: string;
};

export type ApprovalDetail = {
  flow: ApprovalFlow;
  logs: ApprovalLog[];
};

export type ApprovalSubmitRequest = {
  type: string;
  applicantId?: number; // 不传 = 当前用户
  targetUserId?: number;
  tenantId?: number;
  payload: Record<string, unknown>;
  approverId?: number;
  approverRole?: string;
};

export const approvalApi = {
  list: (params?: { type?: string; status?: string; applicantId?: number; approverId?: number }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.status) q.set("status", params.status);
    if (params?.applicantId) q.set("applicantId", String(params.applicantId));
    if (params?.approverId) q.set("approverId", String(params.approverId));
    const qs = q.toString();
    return api.get<ApprovalFlow[]>(`/approval${qs ? `?${qs}` : ""}`);
  },
  get: (id: number) => api.get<ApprovalDetail>(`/approval/${id}`),
  submit: (req: ApprovalSubmitRequest) => api.post<ApprovalFlow>("/approval", req),
  approve: (id: number, comment?: string) =>
    api.post<ApprovalFlow>(`/approval/${id}/approve`, comment ? { comment } : null),
  reject: (id: number, comment?: string) =>
    api.post<ApprovalFlow>(`/approval/${id}/reject`, comment ? { comment } : null),
  resubmit: (id: number, payload: Record<string, unknown>) =>
    api.post<ApprovalFlow>(`/approval/${id}/resubmit`, { payload }),
  cancel: (id: number) => api.post<ApprovalFlow>(`/approval/${id}/cancel`, null),
  /** T22: 批量通过审批。单条失败不阻塞，返回 ok/fail 计数 + 失败 ids。 */
  batchApprove: (flowIds: number[], comment?: string) =>
    api.post<{ ok: number; fail: number; failedIds: number[] }>("/approval/batch/approve", {
      flowIds,
      comment,
    }),
  myPending: () => api.get<ApprovalFlow[]>("/approval/pending/me"),
};

export const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "待审批", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  APPROVED: { text: "已通过", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  REJECTED: { text: "已驳回", cls: "bg-rose-100 text-rose-900 border-rose-300" },
  CANCELLED: { text: "已撤回", cls: "bg-zinc-100 text-zinc-700 border-zinc-300" },
  RESUBMITTED: { text: "已重提", cls: "bg-sky-100 text-sky-900 border-sky-300" },
};

export const TYPE_LABEL: Record<string, string> = {
  PRODUCT_ACCESS: "产品库使用权",
  CROSS_COMPANY_AUTH: "跨公司授权",
};
