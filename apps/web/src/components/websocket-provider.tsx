import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { authClient } from "@/lib/auth-client";

export interface WsEventPayload {
  event: string;
  entityId?: string;
  action: string;
  timestamp: number;
  message?: string;
}

interface WebSocketContextValue {
  isConnected: boolean;
  lastEventTime: number | null;
  /** Last received event (e.g. for tab title "New message" when backgrounded) */
  lastEvent: WsEventPayload | null;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  isConnected: false,
  lastEventTime: null,
  lastEvent: null,
});

export function useWebSocketContext() {
  return useContext(WebSocketContext);
}

interface WebSocketProviderProps {
  children: ReactNode;
}

/**
 * WebSocket provider that manages real-time connection based on auth state
 * 
 * This provider:
 * 1. Monitors auth state to get user ID
 * 2. Connects/disconnects WebSocket based on auth
 * 3. Joins user-specific room for targeted updates
 * 4. Provides connection status to children
 */
export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [userId, setUserId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  // Get auth state
  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      try {
        const session = await authClient.getSession();
        if (mounted) {
          setUserId(session.data?.user?.id);
          setIsLoading(false);
        }
      } catch {
        if (mounted) {
          setUserId(undefined);
          setIsLoading(false);
        }
      }
    };

    checkAuth();

    // Subscribe to auth changes (listen may return an unsubscribe function or nothing)
    const unsubscribe = authClient.$store.listen?.("$sessionSignal", () => {
      checkAuth();
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  // Connect WebSocket with user context
  const { isConnected, lastEvent } = useWebSocket({
    userId,
    enabled: !isLoading, // Only enable after initial auth check
  });

  const value: WebSocketContextValue = {
    isConnected,
    lastEventTime: lastEvent?.timestamp ?? null,
    lastEvent: lastEvent ?? null,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

/**
 * Optional component to show WebSocket connection status
 * Can be placed in header or status bar
 */
export function WebSocketStatus() {
  const { isConnected } = useWebSocketContext();

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={`h-2 w-2 rounded-full ${
          isConnected ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      <span className="text-muted-foreground">
        {isConnected ? "Live" : "Connecting..."}
      </span>
    </div>
  );
}
