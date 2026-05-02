import { useQuery } from "@tanstack/react-query";
import { productApi } from "@/lib/api/product";
import { storeApi } from "@/lib/api/store";
import { taskApi, type TaskListItem } from "@/lib/api/task";
import { approvalApi } from "@/lib/api/approval";

export function useDashboardKpis() {
  const products = useQuery({
    queryKey: ["dashboard", "products-total"],
    queryFn: async (): Promise<number | null> => {
      try {
        const r = await productApi.list(1, 1);
        return r.total ?? 0;
      } catch {
        return null;
      }
    },
  });

  const storesActive = useQuery({
    queryKey: ["dashboard", "stores-active"],
    queryFn: async (): Promise<number | null> => {
      try {
        const list = await storeApi.list();
        return (Array.isArray(list) ? list : []).filter((s) => s.status === "ACTIVE").length;
      } catch {
        return null;
      }
    },
  });

  const tasksToday = useQuery({
    queryKey: ["dashboard", "tasks-today"],
    queryFn: async (): Promise<number | null> => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cutoff = today.getTime();
        const r = await taskApi.list(1, 100, { type: "PRODUCT_PUSH" });
        return (r.records ?? []).filter((t) => {
          if (!t.createdAt) return false;
          const ts = new Date(t.createdAt).getTime();
          return !isNaN(ts) && ts >= cutoff;
        }).length;
      } catch {
        return null;
      }
    },
  });

  const approvalsPending = useQuery({
    queryKey: ["dashboard", "approvals-pending"],
    queryFn: async (): Promise<number | null> => {
      try {
        const r = await approvalApi.myPending();
        return (r ?? []).length;
      } catch {
        return null;
      }
    },
  });

  return { products, storesActive, tasksToday, approvalsPending };
}

export function useFailedTasks(limit = 5) {
  return useQuery({
    queryKey: ["dashboard", "failed-tasks", limit],
    queryFn: async (): Promise<TaskListItem[]> => {
      try {
        const r = await taskApi.list(1, limit, { status: "FAILED" });
        return r?.records ?? [];
      } catch {
        return [];
      }
    },
  });
}
