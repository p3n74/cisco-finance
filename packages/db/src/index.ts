import { env } from "@cisco-finance/env/server";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const basePrisma = new PrismaClient({
  accelerateUrl: env.DATABASE_URL,
});

export const prisma = basePrisma.$extends(withAccelerate());

export type PrismaClientType = typeof prisma;

export default prisma;
