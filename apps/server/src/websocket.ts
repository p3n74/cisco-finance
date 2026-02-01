import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";

/**
 * Event types for real-time updates
 * Using event-based invalidation: clients receive events and decide to refetch
 * This minimizes DB calls by letting React Query handle caching
 */
export const WS_EVENTS = {
  // Data change events (server -> client)
  CASHFLOW_UPDATED: "cashflow:updated",
  ACCOUNT_ENTRY_UPDATED: "account_entry:updated",
  RECEIPT_UPDATED: "receipt:updated",
  ACTIVITY_LOGGED: "activity:logged",
  STATS_UPDATED: "stats:updated",
  BUDGET_UPDATED: "budget:updated",
  CHAT_MESSAGE_NEW: "chat:message",
  CHAT_PING: "chat:ping",

  // Room management
  JOIN_USER_ROOM: "join:user",
  LEAVE_USER_ROOM: "leave:user",

  // Presence (online / away / offline)
  PRESENCE_HEARTBEAT: "presence:heartbeat",
  PRESENCE_UPDATE: "presence:update",
} as const;

export type PresenceStatus = "online" | "away" | "offline";

const PRESENCE_ROOM = "presence";
const AWAY_AFTER_MS = 5 * 60 * 1000; // 5 min no activity = away
const AWAY_CHECK_INTERVAL_MS = 60 * 1000; // check every 1 min

interface PresenceEntry {
  status: "online" | "away";
  lastActivity: number;
  socketIds: Set<string>;
}

const presenceMap = new Map<string, PresenceEntry>();
let awayCheckInterval: ReturnType<typeof setInterval> | null = null;

function broadcastPresence(userId: string, status: PresenceStatus) {
  if (!io) return;
  io.to(PRESENCE_ROOM).emit(WS_EVENTS.PRESENCE_UPDATE, { userId, status });
}

function startAwayCheckInterval() {
  if (awayCheckInterval) return;
  awayCheckInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, entry] of presenceMap.entries()) {
      if (entry.status === "online" && now - entry.lastActivity >= AWAY_AFTER_MS) {
        entry.status = "away";
        broadcastPresence(userId, "away");
      }
    }
  }, AWAY_CHECK_INTERVAL_MS);
}

export type WsEventType = typeof WS_EVENTS[keyof typeof WS_EVENTS];

/**
 * Event payload structure
 * Minimal payload to reduce bandwidth - just enough for clients to know what changed
 */
export interface WsEventPayload {
  event: WsEventType;
  entityId?: string;
  action: "created" | "updated" | "archived" | "bound" | "unbound" | "deleted" | "linked" | "completed";
  timestamp: number;
  /** Optional message for toast notifications */
  message?: string;
  /** Optional preview (e.g. chat message snippet) */
  preview?: string;
}

// Store for debouncing events per room
const eventDebounceMap = new Map<string, NodeJS.Timeout>();
const pendingEvents = new Map<string, WsEventPayload[]>();

const DEBOUNCE_MS = 100; // Batch events within 100ms window

let io: Server | null = null;

/**
 * Initialize WebSocket server
 */
export function initWebSocket(httpServer: HttpServer, corsOrigin: string): Server {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Optimize for lower latency
    transports: ["websocket", "polling"],
    // Ping interval for connection health
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // Handle user room joining (for user-specific events) + presence
    socket.on(WS_EVENTS.JOIN_USER_ROOM, (userId: string) => {
      if (userId && typeof userId === "string") {
        const room = `user:${userId}`;
        socket.join(room);
        socket.join(PRESENCE_ROOM);
        let entry = presenceMap.get(userId);
        if (!entry) {
          entry = { status: "online", lastActivity: Date.now(), socketIds: new Set() };
          presenceMap.set(userId, entry);
        }
        entry.socketIds.add(socket.id);
        entry.lastActivity = Date.now();
        entry.status = "online";
        broadcastPresence(userId, "online");
        startAwayCheckInterval();
        console.log(`[WS] Socket ${socket.id} joined room ${room} and presence`);
      }
    });

    // Handle user room leaving
    socket.on(WS_EVENTS.LEAVE_USER_ROOM, (userId: string) => {
      if (userId && typeof userId === "string") {
        const room = `user:${userId}`;
        socket.leave(room);
        socket.leave(PRESENCE_ROOM);
        const entry = presenceMap.get(userId);
        if (entry) {
          entry.socketIds.delete(socket.id);
          if (entry.socketIds.size === 0) {
            presenceMap.delete(userId);
            broadcastPresence(userId, "offline");
          }
        }
        console.log(`[WS] Socket ${socket.id} left room ${room}`);
      }
    });

    socket.on(WS_EVENTS.PRESENCE_HEARTBEAT, () => {
      const userId = Array.from(presenceMap.entries()).find(([, e]) => e.socketIds.has(socket.id))?.[0];
      if (userId) {
        const entry = presenceMap.get(userId);
        if (entry) {
          entry.lastActivity = Date.now();
          if (entry.status === "away") {
            entry.status = "online";
            broadcastPresence(userId, "online");
          }
        }
      }
    });

    socket.on("disconnect", (reason) => {
      const userId = Array.from(presenceMap.entries()).find(([, e]) => e.socketIds.has(socket.id))?.[0];
      if (userId) {
        const entry = presenceMap.get(userId);
        if (entry) {
          entry.socketIds.delete(socket.id);
          if (entry.socketIds.size === 0) {
            presenceMap.delete(userId);
            broadcastPresence(userId, "offline");
          }
        }
      }
      console.log(`[WS] Client disconnected: ${socket.id}, reason: ${reason}`);
    });
  });

  console.log("[WS] WebSocket server initialized");
  return io;
}

/**
 * Get the WebSocket server instance
 */
export function getIO(): Server | null {
  return io;
}

/**
 * Get current presence status for user IDs (for tRPC presence.getStatuses)
 */
export function getPresenceMap(): Record<string, PresenceStatus> {
  const out: Record<string, PresenceStatus> = {};
  for (const [userId, entry] of presenceMap.entries()) {
    out[userId] = entry.status;
  }
  return out;
}

/**
 * Emit event to specific user room with debouncing
 * Events are batched within DEBOUNCE_MS window to prevent spam
 */
export function emitToUser(userId: string, payload: Omit<WsEventPayload, "timestamp">) {
  if (!io) {
    console.warn("[WS] WebSocket not initialized, skipping emit");
    return;
  }

  const room = `user:${userId}`;
  const fullPayload: WsEventPayload = {
    ...payload,
    timestamp: Date.now(),
  };

  // Add to pending events for this room
  const pending = pendingEvents.get(room) ?? [];
  pending.push(fullPayload);
  pendingEvents.set(room, pending);

  // Clear existing debounce timer
  const existingTimer = eventDebounceMap.get(room);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new debounce timer
  const timer = setTimeout(() => {
    const events = pendingEvents.get(room) ?? [];
    if (events.length > 0) {
      // Deduplicate events by type (keep latest)
      const dedupedEvents = deduplicateEvents(events);
      
      // Emit batched events
      io?.to(room).emit("batch:update", dedupedEvents);
      
      console.log(`[WS] Emitted ${dedupedEvents.length} events to room ${room}`);
    }
    pendingEvents.delete(room);
    eventDebounceMap.delete(room);
  }, DEBOUNCE_MS);

  eventDebounceMap.set(room, timer);
}

/**
 * Emit event to all connected clients (global events)
 * Used for public data like receipt submissions
 */
export function emitToAll(payload: Omit<WsEventPayload, "timestamp">) {
  if (!io) {
    console.warn("[WS] WebSocket not initialized, skipping emit");
    return;
  }

  const fullPayload: WsEventPayload = {
    ...payload,
    timestamp: Date.now(),
  };

  // For global events, use a global debounce key
  const room = "global";
  const pending = pendingEvents.get(room) ?? [];
  pending.push(fullPayload);
  pendingEvents.set(room, pending);

  const existingTimer = eventDebounceMap.get(room);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    const events = pendingEvents.get(room) ?? [];
    if (events.length > 0) {
      const dedupedEvents = deduplicateEvents(events);
      io?.emit("batch:update", dedupedEvents);
      console.log(`[WS] Emitted ${dedupedEvents.length} global events`);
    }
    pendingEvents.delete(room);
    eventDebounceMap.delete(room);
  }, DEBOUNCE_MS);

  eventDebounceMap.set(room, timer);
}

/**
 * Deduplicate events by event type, keeping the latest
 * This prevents multiple rapid updates from causing unnecessary refetches
 */
function deduplicateEvents(events: WsEventPayload[]): WsEventPayload[] {
  const eventMap = new Map<string, WsEventPayload>();
  
  for (const event of events) {
    const key = event.entityId ? `${event.event}:${event.entityId}` : event.event;
    eventMap.set(key, event);
  }
  
  return Array.from(eventMap.values());
}
