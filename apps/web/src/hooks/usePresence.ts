import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

export type PresenceStatus = "online" | "away" | "offline";

/**
 * Get presence status (online/away/offline) for the given user IDs.
 * Refetches when WebSocket receives presence:update.
 */
export function usePresence(userIds: string[], enabled = true) {
  const options = trpc.presence.getStatuses.queryOptions(
    { userIds: userIds.length ? userIds : [] },
    { enabled: enabled && userIds.length > 0 }
  );
  const query = useQuery({
    ...options,
    enabled: enabled && userIds.length > 0,
  });
  return {
    statuses: (query.data ?? {}) as Record<string, PresenceStatus>,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
