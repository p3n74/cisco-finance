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

export async function createContext(opts: CreateExpressContextOptions) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(opts.req.headers),
  });
  console.log("[context] createContext called, prisma:", !!prisma);
  return {
    session,
    prisma,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
