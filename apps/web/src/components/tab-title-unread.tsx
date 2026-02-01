import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { useWebSocketContext } from "@/components/websocket-provider";
import { queryClient, trpc } from "@/utils/trpc";

const BASE_TITLE = "TRACE";
const CHAT_MESSAGE_EVENT = "chat:message";

/**
 * Updates the browser tab title like Messenger:
 * - "(3) TRACE" when there are unread messages
 * - "New message - TRACE" when a message arrives and the tab is in the background
 * - "TRACE" when no unread messages
 */
export function TabTitleUnread() {
  const { data: session } = authClient.useSession();
  const { lastEvent } = useWebSocketContext();
  const prevTitleRef = useRef<string>(BASE_TITLE);

  const unreadOptions = trpc.chat.getUnreadCount.queryOptions();
  const { data: unreadData } = useQuery({
    ...unreadOptions,
    enabled: !!session,
  });

  const unreadCount = unreadData?.count ?? 0;

  useEffect(() => {
    const updateTitle = () => {
      let next: string;
      if (document.hidden && lastEvent?.event === CHAT_MESSAGE_EVENT) {
        next = `New message - ${BASE_TITLE}`;
      } else if (unreadCount > 0) {
        next = `(${unreadCount > 99 ? "99+" : unreadCount}) ${BASE_TITLE}`;
      } else {
        next = BASE_TITLE;
      }
      if (next !== prevTitleRef.current) {
        document.title = next;
        prevTitleRef.current = next;
      }
    };

    updateTitle();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // When user focuses the tab, refresh title from unread count (query may have updated)
        queryClient.invalidateQueries({ queryKey: trpc.chat.getUnreadCount.queryOptions().queryKey });
      }
      updateTitle();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [unreadCount, lastEvent?.event, lastEvent?.timestamp]);

  return null;
}
