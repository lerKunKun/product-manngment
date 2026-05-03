import { useQuery, useQueryClient } from "@tanstack/react-query";
import { taskApi } from "@/lib/api/task";

export type UseTasksParams = {
  page: number;
  size: number;
  type?: string;
  status?: string;
  storeId?: number;
  parentTaskId?: number;
};

export type UseTasksOptions = {
  refetchInterval?: number | false;
  enabled?: boolean;
};

export function useTasks(params: UseTasksParams, options?: UseTasksOptions) {
  return useQuery({
    queryKey: ["tasks", params],
    queryFn: () =>
      taskApi.list(params.page, params.size, {
        type: params.type,
        status: params.status,
        storeId: params.storeId,
        parentTaskId: params.parentTaskId,
      }),
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled,
  });
}

export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["tasks"] });
}
