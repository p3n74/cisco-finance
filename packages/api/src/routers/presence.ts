import { z } from "zod";
import { router, whitelistedProcedure } from "../index";

/**
 * Presence router: get online/away/offline status for user IDs.
 * Status is tracked by the WebSocket server (heartbeat + away after 5 min).
 * Whitelisted users only.
 */
export const presenceRouter = router({
  getStatuses: whitelistedProcedure
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
