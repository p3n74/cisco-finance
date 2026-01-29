import { env } from "@cisco-finance/env/server";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const isAccelerate = env.DATABASE_URL.startsWith("prisma://") || env.DATABASE_URL.startsWith("prisma+postgres://");

const basePrisma = new PrismaClient(
  isAccelerate
    ? { accelerateUrl: env.DATABASE_URL }
    : {
        datasources: {
          db: {
            url: env.DATABASE_URL,
          },
        },
      },
);

export const prisma = isAccelerate 
  ? basePrisma.$extends(withAccelerate())
  : basePrisma;

export type PrismaClientType = typeof prisma;

export default prisma;
