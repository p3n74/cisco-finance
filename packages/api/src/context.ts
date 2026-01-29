import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

import { auth } from "@cisco-finance/auth";
import { env } from "@cisco-finance/env/server";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { fromNodeHeaders } from "better-auth/node";

// Create prisma client directly to avoid workspace import issues
const prisma = new PrismaClient({
  accelerateUrl: env.DATABASE_URL,
}).$extends(withAccelerate());

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
} as const;

export type WsEventType = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export interface WsEventPayload {
  event: WsEventType;
  entityId?: string;
  action: "created" | "updated" | "archived" | "bound" | "unbound" | "deleted";
  /** Optional message for toast notifications */
  message?: string;
}

/**
 * WebSocket emitter functions that can be injected into context
 */
export interface WsEmitter {
  emitToUser: (userId: string, payload: WsEventPayload) => void;
  emitToAll: (payload: WsEventPayload) => void;
}

// Store for the WebSocket emitter (set by server)
let wsEmitter: WsEmitter | null = null;

export function setWsEmitter(emitter: WsEmitter) {
  wsEmitter = emitter;
}

export function getWsEmitter(): WsEmitter | null {
  return wsEmitter;
}

export async function createContext(opts: CreateExpressContextOptions) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(opts.req.headers),
  });
  console.log("[context] createContext called, prisma:", !!prisma);
  return {
    session,
    prisma,
    ws: wsEmitter,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
