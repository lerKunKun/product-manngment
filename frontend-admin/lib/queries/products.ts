import { useQuery, useQueryClient } from "@tanstack/react-query";
import { productApi } from "@/lib/api/product";

export type UseProductsParams = {
  page: number;
  size: number;
  status?: string;
  q?: string;
  ownerCompanyId?: number;
};

export function useProducts(params: UseProductsParams) {
  return useQuery({
    queryKey: ["products", params],
    queryFn: () =>
      productApi.list(
        params.page,
        params.size,
        params.q ?? "",
        params.status ?? "",
        params.ownerCompanyId
      ),
  });
}

export function useInvalidateProducts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["products"] });
}
