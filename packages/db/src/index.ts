import { env } from "@cisco-finance/env/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const isAccelerate = env.DATABASE_URL.startsWith("prisma://") || env.DATABASE_URL.startsWith("prisma+postgres://");

// Prisma 7 only allows accelerateUrl or adapter in the constructor (no datasourceUrl/datasources).
// Use Accelerate when URL is prisma://; otherwise use the pg driver adapter with DATABASE_URL.
const basePrisma = isAccelerate
  ? new PrismaClient({ accelerateUrl: env.DATABASE_URL })
  : new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

export const prisma = isAccelerate 
  ? basePrisma.$extends(withAccelerate())
  : basePrisma;

export type PrismaClientType = typeof prisma;

export default prisma;
