import { z } from "zod";
import { protectedProcedure, router } from "../index";

/**
 * Presence router: get online/away/offline status for user IDs.
 * Status is tracked by the WebSocket server (heartbeat + away after 5 min).
 */
export const presenceRouter = router({
  getStatuses: protectedProcedure
    .input(z.object({ userIds: z.array(z.string()) }))
    .query(({ ctx, input }) => {
      const map = ctx.getPresenceMap();
      const result: Record<string, "online" | "away" | "offline"> = {};
      for (const userId of input.userIds) {
        result[userId] = map[userId] ?? "offline";
      }
      return result;
    }),
});
