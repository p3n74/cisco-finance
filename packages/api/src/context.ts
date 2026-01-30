import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

import { auth } from "@cisco-finance/auth";
import { env } from "@cisco-finance/env/server";
import { prisma } from "@cisco-finance/db";
import { fromNodeHeaders } from "better-auth/node";

// Use the shared prisma client from @cisco-finance/db
console.log("[context] prisma client created:", !!prisma);

/**
 * WebSocket event types for real-time updates
 */
export const WS_EVENTS = {
  CASHFLOW_UPDATED: "cashflow:updated",
  ACCOUNT_ENTRY_UPDATED: "account_entry:updated",
  RECEIPT_UPDATED: "receipt:updated",
  ACTIVITY_LOGGED: "activity:logged",
  STATS_UPDATED: "stats:updated",
  BUDGET_UPDATED: "budget:updated",
  CHAT_MESSAGE_NEW: "chat:message",
} as const;

export type WsEventType = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export interface WsEventPayload {
  event: WsEventType;
  entityId?: string;
  action: "created" | "updated" | "archived" | "bound" | "unbound" | "deleted" | "linked" | "completed";
  /** Optional message for toast notifications */
  message?: string;
}

export type PresenceStatus = "online" | "away" | "offline";

/**
 * WebSocket emitter functions that can be injected into context
 */
export interface WsEmitter {
  emitToUser: (userId: string, payload: WsEventPayload) => void;
  emitToAll: (payload: WsEventPayload) => void;
}

export type GetPresenceMap = () => Record<string, PresenceStatus>;

// Store for the WebSocket emitter and presence getter (set by server)
let wsEmitter: WsEmitter | null = null;
let presenceGetter: GetPresenceMap | null = null;

export function setWsEmitter(emitter: WsEmitter) {
  wsEmitter = emitter;
}

export function getWsEmitter(): WsEmitter | null {
  return wsEmitter;
}

export function setPresenceGetter(getter: GetPresenceMap) {
  presenceGetter = getter;
}

export function getPresenceGetter(): GetPresenceMap | null {
  return presenceGetter;
}

export async function createContext(opts: CreateExpressContextOptions) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(opts.req.headers),
  });
  console.log("[context] createContext called, prisma:", !!prisma);

  let userRole: string | null = null;
  if (session?.user?.email) {
    const authorizedUser = await prisma.authorizedUser.findUnique({
      where: { email: session.user.email },
    });
    userRole = authorizedUser?.role ?? null;
  }

  return {
    session,
    userRole,
    prisma,
    ws: wsEmitter,
    getPresenceMap: presenceGetter ?? (() => ({})),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
