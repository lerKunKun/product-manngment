import { api } from "./client";

/**
 * 推送 API（W2-PUSH-04 + W2-PUSH-06）。
 *
 * <p>Day 6 是同步：HTTP 响应在 worker 调用回来之后才返回；Track C Day 7 会
 * 切到 @Async + 队列，但响应体形状不变（仍只返回 taskId）。前端通过 taskApi
 * 轮询任务状态判断完成与否。
 */
export type BatchPushResp = {
  parentTaskId: number;
  subTaskIds: number[];
  summary: { success: number; failed: number; partial: number };
};

export const pushApi = {
  push: (params: {
    productId: number;
    storeId: number;
    triggeredBy?: number | null;
  }) => api.post<{ taskId: number }>("/push/product", params),

  /** W2-PUSH-05: 批量推送，后端串行循环推送，所有子任务挂同一个 parent_task_id。 */
  pushBatch: (params: {
    productIds: number[];
    storeId: number;
    triggeredBy?: number | null;
  }) => api.post<BatchPushResp>("/push/batch", params),
};
