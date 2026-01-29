import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../index";
import { WS_EVENTS } from "../context";

const ROLES = ["VP_FINANCE", "AUDITOR", "TREASURER", "WAYS_AND_MEANS"] as const;

// Middleware to check if user is VP Finance
const vpFinanceProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.userRole !== "VP_FINANCE") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the VP Finance can perform this action",
    });
  }
  return next();
});

export const teamRouter = router({
  // Get current user's role
  getMyRole: protectedProcedure.query(({ ctx }) => {
    return { role: ctx.userRole };
  }),

  // List all authorized users
  list: protectedProcedure.query(async ({ ctx }) => {
    const users = await ctx.prisma.authorizedUser.findMany({
      orderBy: { createdAt: "desc" },
    });
    
    // Also fetch their user details if they have registered
    const emails = users.map(u => u.email);
    const registeredUsers = await ctx.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true, name: true, image: true, id: true },
    });

    const registeredMap = new Map(registeredUsers.map(u => [u.email, u]));

    return users.map(u => ({
      ...u,
      registeredUser: registeredMap.get(u.email) || null,
    }));
  }),

  // Add a new authorized user
  add: vpFinanceProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(ROLES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if already exists
      const existing = await ctx.prisma.authorizedUser.findUnique({
        where: { email: input.email },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already authorized",
        });
      }

      const user = await ctx.prisma.authorizedUser.create({
        data: {
          email: input.email,
          role: input.role,
        },
      });

      // Log activity
      await ctx.prisma.activityLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "created",
          entityType: "authorized_user",
          entityId: user.id,
          description: `added ${input.email} as ${input.role}`,
        },
      });

      return user;
    }),

  // Update a user's role
  update: vpFinanceProcedure
    .input(
      z.object({
        id: z.string(),
        role: z.enum(ROLES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.authorizedUser.update({
        where: { id: input.id },
        data: { role: input.role },
      });

      // Log activity
      await ctx.prisma.activityLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "updated",
          entityType: "authorized_user",
          entityId: user.id,
          description: `updated ${user.email} role to ${input.role}`,
        },
      });

      return user;
    }),

  // Remove an authorized user
  remove: vpFinanceProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.authorizedUser.findUnique({
        where: { id: input.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      await ctx.prisma.authorizedUser.delete({
        where: { id: input.id },
      });

      // Log activity
      await ctx.prisma.activityLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "deleted",
          entityType: "authorized_user",
          entityId: input.id,
          description: `removed ${user.email} from authorized users`,
        },
      });

      return { success: true };
    }),
});
