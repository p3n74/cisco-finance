import { useEffect, useRef, useCallback, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { env } from "@cisco-finance/env/web";
import { playNotificationSound } from "@/lib/notification-sound";
import { queryClient, trpc } from "@/utils/trpc";

/**
 * WebSocket event types - must match server
 */
const WS_EVENTS = {
  CASHFLOW_UPDATED: "cashflow:updated",
  ACCOUNT_ENTRY_UPDATED: "account_entry:updated",
  RECEIPT_UPDATED: "receipt:updated",
  ACTIVITY_LOGGED: "activity:logged",
  STATS_UPDATED: "stats:updated",
  CHAT_MESSAGE_NEW: "chat:message",
  CHAT_PING: "chat:ping",
  JOIN_USER_ROOM: "join:user",
  LEAVE_USER_ROOM: "leave:user",
  PRESENCE_HEARTBEAT: "presence:heartbeat",
  PRESENCE_UPDATE: "presence:update",
} as const;

interface WsEventPayload {
  event: string;
  entityId?: string;
  action: string;
  timestamp: number;
  /** Optional message for toast notifications */
  message?: string;
  /** Optional preview (e.g. chat message snippet) */
  preview?: string;
}

/**
 * Debounce configuration for query invalidation
 * Prevents excessive database calls when multiple events arrive
 */
const INVALIDATION_DEBOUNCE_MS = 300;

/**
 * Map of event types to query keys that should be invalidated
 * This is the key optimization - we only invalidate relevant queries
 */
const EVENT_TO_QUERY_KEYS: Record<string, string[][]> = {
  [WS_EVENTS.CASHFLOW_UPDATED]: [
    ["cashflowEntries"],
    ["overview"],
  ],
  [WS_EVENTS.ACCOUNT_ENTRY_UPDATED]: [
    ["accountEntries"],
    ["overview"],
  ],
  [WS_EVENTS.RECEIPT_UPDATED]: [
    ["receiptSubmission"],
    ["cashflowEntries"], // Receipts affect cashflow entry display
  ],
  [WS_EVENTS.ACTIVITY_LOGGED]: [
    ["activityLog"],
  ],
  [WS_EVENTS.STATS_UPDATED]: [
    ["overview"],
  ],
  // Chat: invalidated explicitly below with trpc query keys (generic ["chat"] doesn't match tRPC key shape)
  [WS_EVENTS.CHAT_MESSAGE_NEW]: [],
  [WS_EVENTS.PRESENCE_UPDATE]: [
    ["presence"],
  ],
};

/**
 * Action to icon/title mapping for toast notifications
 */
const ACTION_CONFIG: Record<string, { title: string; icon: string }> = {
  created: { title: "Created", icon: "✨" },
  updated: { title: "Updated", icon: "📝" },
  archived: { title: "Archived", icon: "📦" },
  bound: { title: "Linked", icon: "🔗" },
  unbound: { title: "Unlinked", icon: "🔓" },
  deleted: { title: "Deleted", icon: "🗑️" },
  verified: { title: "Verified", icon: "✅" },
  uploaded: { title: "Uploaded", icon: "📤" },
};

/**
 * Show a toast notification for activity events
 */
function showActivityToast(action: string, message: string) {
  const config = ACTION_CONFIG[action] ?? { title: "Activity", icon: "📋" };
  
  toast(message, {
    description: config.title,
    position: "bottom-right",
    duration: 4000,
    icon: config.icon,
  });
}

interface UseWebSocketOptions {
  userId?: string;
  enabled?: boolean;
}

interface WebSocketState {
  isConnected: boolean;
  lastEvent: WsEventPayload | null;
}

/**
 * Hook for managing WebSocket connection and real-time updates
 * 
 * Key optimizations:
 * 1. Event-based invalidation (not data pushing) - clients decide when to refetch
 * 2. Debounced invalidation - batches multiple rapid events
 * 3. Selective query invalidation - only invalidates relevant queries
 * 4. User rooms - prevents unnecessary updates for other users' data
 */
export function useWebSocket({ userId, enabled = true }: UseWebSocketOptions): WebSocketState {
  const socketRef = useRef<Socket | null>(null);
  const pendingInvalidationsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    lastEvent: null,
  });

  /**
   * Process pending invalidations with debounce
   * This batches multiple rapid events into a single invalidation cycle
   */
  const processPendingInvalidations = useCallback(() => {
    const queryKeys = Array.from(pendingInvalidationsRef.current);
    pendingInvalidationsRef.current.clear();

    if (queryKeys.length === 0) return;

    // Deduplicate and invalidate
    const uniqueKeys = [...new Set(queryKeys)];
    
    console.log("[WS] Invalidating queries:", uniqueKeys);
    
    for (const keyString of uniqueKeys) {
      const key = JSON.parse(keyString) as string[];
      queryClient.invalidateQueries({ queryKey: key });
    }
  }, []);

  /**
   * Schedule invalidation with debounce
   */
  const scheduleInvalidation = useCallback((queryKeys: string[][]) => {
    // Add to pending set
    for (const key of queryKeys) {
      pendingInvalidationsRef.current.add(JSON.stringify(key));
    }

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      processPendingInvalidations();
    }, INVALIDATION_DEBOUNCE_MS);
  }, [processPendingInvalidations]);

  /**
   * Handle batch of events from server
   */
  const handleBatchUpdate = useCallback((events: WsEventPayload[]) => {
    console.log("[WS] Received batch update:", events.length, "events");

    const allQueryKeys: string[][] = [];

    for (const event of events) {
      setState((prev) => ({ ...prev, lastEvent: event }));

      // Get query keys to invalidate for this event type
      const queryKeys = EVENT_TO_QUERY_KEYS[event.event];
      if (queryKeys) {
        allQueryKeys.push(...queryKeys);
      }

      // Show toast notification for activity events with messages
      if (event.event === WS_EVENTS.ACTIVITY_LOGGED && event.message) {
        showActivityToast(event.action, event.message);
      }

      // New chat message: toast, sound, and invalidate chat queries so badge/tab title update
      if (event.event === WS_EVENTS.CHAT_MESSAGE_NEW) {
        const label = event.message ?? "New message";
        toast(label, {
          description: event.preview ?? undefined,
          position: "bottom-left",
          duration: 5000,
          icon: "💬",
        });
        playNotificationSound();
        queryClient.invalidateQueries({ queryKey: trpc.chat.getUnreadCount.queryOptions().queryKey });
        queryClient.invalidateQueries({ queryKey: trpc.chat.listConversations.queryOptions().queryKey });
      }

      // Ping: play notification sound and show "X has pinged you" toast
      if (event.event === WS_EVENTS.CHAT_PING) {
        const label = event.message ?? "Someone has pinged you";
        toast(label, {
          position: "bottom-left",
          duration: 4000,
          icon: "🔔",
        });
        playNotificationSound();
      }
    }

    if (allQueryKeys.length > 0) {
      scheduleInvalidation(allQueryKeys);
    }
  }, [scheduleInvalidation]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Create socket connection
    const socket = io(env.VITE_SERVER_URL, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      // Reconnection settings
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[WS] Connected:", socket.id);
      setState((prev) => ({ ...prev, isConnected: true }));

      // Join user room (and presence room on server) if userId is provided
      if (userId) {
        socket.emit(WS_EVENTS.JOIN_USER_ROOM, userId);
      }
    });

    socket.on("disconnect", (reason) => {
      console.log("[WS] Disconnected:", reason);
      setState((prev) => ({ ...prev, isConnected: false }));
    });

    socket.on("connect_error", (error) => {
      console.error("[WS] Connection error:", error.message);
    });

    // Listen for batched updates
    socket.on("batch:update", handleBatchUpdate);

    // Presence: when any user's status changes, refetch presence so UI updates
    socket.on(WS_EVENTS.PRESENCE_UPDATE, () => {
      queryClient.invalidateQueries({ queryKey: ["presence"] });
    });

    // Presence: heartbeat every 2 min and on window focus so we stay "online" (not "away")
    const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const onPresenceHeartbeat = () => {
      if (socket.connected && userId) socket.emit(WS_EVENTS.PRESENCE_HEARTBEAT);
    };
    if (userId) {
      heartbeatTimer = setInterval(onPresenceHeartbeat, HEARTBEAT_INTERVAL_MS);
      window.addEventListener("focus", onPresenceHeartbeat);
    }

    // Cleanup
    return () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (userId) window.removeEventListener("focus", onPresenceHeartbeat);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      if (userId) {
        socket.emit(WS_EVENTS.LEAVE_USER_ROOM, userId);
      }
      
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, userId, handleBatchUpdate]);

  // Handle userId changes (user login/logout)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (userId) {
      socket.emit(WS_EVENTS.JOIN_USER_ROOM, userId);
    }
  }, [userId]);

  return state;
}

/**
 * Simple connection status hook for UI indicators
 */
export function useWebSocketStatus(): boolean {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = io(env.VITE_SERVER_URL, {
      transports: ["websocket"],
      withCredentials: true,
      autoConnect: false,
    });

    // Just check if we can connect
    socket.connect();

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    return () => {
      socket.disconnect();
    };
  }, []);

  return isConnected;
}
