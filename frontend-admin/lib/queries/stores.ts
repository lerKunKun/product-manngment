import { useQuery, useQueryClient } from "@tanstack/react-query";
import { storeApi } from "@/lib/api/store";

export type UseStoresParams = {
  tenantId?: number;
  partnerCollab?: boolean;
  devStore?: boolean;
};

export function useStores(params?: UseStoresParams) {
  return useQuery({
    queryKey: ["stores", params ?? {}],
    queryFn: () => storeApi.list(params),
  });
}

export function useInvalidateStores() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["stores"] });
}
