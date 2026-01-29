import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../index";

const ACCOUNT_OPTIONS = ["GCash", "GoTyme", "Cash", "BPI"] as const;

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),

  // Account entries (treasury ledger)
  accountEntries: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const entries = await ctx.prisma.accountEntry.findMany({
        where: {
          userId: ctx.session.user.id,
        },
        orderBy: {
          date: "desc",
        },
        include: {
          cashflowEntry: {
            select: { id: true, description: true },
          },
        },
      });

      return entries.map((entry) => ({
        id: entry.id,
        date: entry.date,
        description: entry.description,
        account: entry.account,
        amount: Number(entry.amount),
        currency: entry.currency,
        notes: entry.notes,
        isActive: entry.isActive,
        archivedAt: entry.archivedAt,
        isVerified: !!entry.cashflowEntry,
        cashflowEntry: entry.cashflowEntry,
      }));
    }),
    listUnverified: protectedProcedure.query(async ({ ctx }) => {
      const entries = await ctx.prisma.accountEntry.findMany({
        where: {
          userId: ctx.session.user.id,
          isActive: true,
          cashflowEntry: null, // Not yet verified
        },
        orderBy: {
          date: "desc",
        },
        select: {
          id: true,
          date: true,
          description: true,
          account: true,
          amount: true,
        },
      });

      return entries.map((e) => ({
        ...e,
        amount: Number(e.amount),
      }));
    }),
    create: protectedProcedure
      .input(
        z.object({
          date: z.coerce.date(),
          description: z.string().min(2),
          account: z.enum(ACCOUNT_OPTIONS),
          amount: z.coerce.number(),
          currency: z.string().length(3).optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.accountEntry.create({
          data: {
            userId: ctx.session.user.id,
            date: input.date,
            description: input.description,
            account: input.account,
            amount: input.amount,
            currency: input.currency ?? "PHP",
            notes: input.notes,
          },
        });
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.string().min(1),
          date: z.coerce.date(),
          description: z.string().min(2),
          account: z.enum(ACCOUNT_OPTIONS),
          amount: z.coerce.number(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.prisma.accountEntry.updateMany({
          where: {
            id: input.id,
            userId: ctx.session.user.id,
          },
          data: {
            date: input.date,
            description: input.description,
            account: input.account,
            amount: input.amount,
          },
        });
        return { updated: result.count };
      }),
    archive: protectedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.prisma.accountEntry.updateMany({
          where: {
            id: input.id,
            userId: ctx.session.user.id,
          },
          data: {
            isActive: false,
            archivedAt: new Date(),
          },
        });
        return { updated: result.count };
      }),
  }),

  // Cashflow entries (verified official transactions)
  cashflowEntries: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const entries = await ctx.prisma.cashflowEntry.findMany({
        where: {
          userId: ctx.session.user.id,
        },
        orderBy: {
          date: "desc",
        },
        include: {
          receipts: {
            select: { id: true },
          },
          accountEntry: {
            select: { id: true, description: true, account: true },
          },
        },
      });

      return entries.map((entry) => ({
        id: entry.id,
        date: entry.date,
        description: entry.description,
        category: entry.category,
        amount: Number(entry.amount),
        currency: entry.currency,
        notes: entry.notes,
        isActive: entry.isActive,
        archivedAt: entry.archivedAt,
        receiptsCount: entry.receipts.length,
        accountEntryId: entry.accountEntryId,
        accountEntry: entry.accountEntry,
      }));
    }),
    create: protectedProcedure
      .input(
        z.object({
          date: z.coerce.date(),
          description: z.string().min(2),
          category: z.string().min(2),
          amount: z.coerce.number(),
          currency: z.string().length(3).optional(),
          notes: z.string().optional(),
          accountEntryId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.cashflowEntry.create({
          data: {
            userId: ctx.session.user.id,
            date: input.date,
            description: input.description,
            category: input.category,
            amount: input.amount,
            currency: input.currency ?? "PHP",
            notes: input.notes,
            accountEntryId: input.accountEntryId,
          },
        });
      }),
    archive: protectedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.prisma.cashflowEntry.updateMany({
          where: {
            id: input.id,
            userId: ctx.session.user.id,
          },
          data: {
            isActive: false,
            archivedAt: new Date(),
          },
        });
        return { updated: result.count };
      }),
  }),
});
export type AppRouter = typeof appRouter;
