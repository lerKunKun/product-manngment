import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inboxApi } from "@/lib/api/inbox";

export function useUnreadInboxCount() {
  return useQuery({
    queryKey: ["inbox", "unread-count"],
    queryFn: () => inboxApi.unreadCount(),
    refetchInterval: 30_000,
  });
}

export function useInvalidateInbox() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["inbox"] });
}
