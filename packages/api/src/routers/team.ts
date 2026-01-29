import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../index";
import { WS_EVENTS } from "../context";
import { sendEmail } from "../services/email";
import { env } from "@cisco-finance/env/server";
import type { Context } from "../context";

const ROLES = ["VP_FINANCE", "AUDITOR", "TREASURER", "WAYS_AND_MEANS"] as const;

const ROLE_LABELS: Record<string, string> = {
  VP_FINANCE: "Vice President for Finance",
  AUDITOR: "Auditor",
  TREASURER: "Treasurer",
  WAYS_AND_MEANS: "Ways and Means Officer",
};

// Helper to get the VP Finance's first name for email sender display
async function getSenderName(prisma: Context["prisma"]) {
  const vpAuth = await prisma.authorizedUser.findFirst({
    where: { role: "VP_FINANCE" },
  });
  if (vpAuth) {
    const vpUser = await prisma.user.findUnique({
      where: { email: vpAuth.email },
      select: { name: true },
    });
    if (vpUser) {
      const firstName = vpUser.name.split(" ")[0];
      return `${firstName} from CISCO`;
    }
  }
  return "CISCO Finance";
}

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

      const senderName = await getSenderName(ctx.prisma);

      // Send Invitation Email
      await sendEmail(
        input.email,
        `[CISCO FINANCE] Invitation to join the team`,
        `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #1a365d; color: white; padding: 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">CISCO FINANCE</h1>
            </div>
            
            <div style="padding: 30px; color: #333; line-height: 1.6;">
              <p style="font-size: 16px;">Hello,</p>
              <p>You have been invited to join the <strong>CISCO Finance Platform</strong> as a team member.</p>
              
              <div style="background-color: #f0f7ff; border-left: 4px solid #3182ce; padding: 20px; margin: 25px 0;">
                <p style="margin: 0;"><strong>Role Assigned:</strong> ${ROLE_LABELS[input.role]}</p>
                <p style="margin: 5px 0 0 0;"><strong>Invited By:</strong> ${ctx.session.user.name}</p>
              </div>
              
              <p>Please click the button below to sign in and access the dashboard. Use your authorized email address to log in via Google.</p>
              
              <div style="text-align: center; margin-top: 30px;">
                <a href="${env.CORS_ORIGIN || "#"}" style="background-color: #3182ce; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Join the Team</a>
              </div>
            </div>
            
            <div style="background-color: #f7fafc; padding: 15px; text-align: center; color: #a0aec0; font-size: 12px; border-top: 1px solid #e2e8f0;">
              <p>If you were not expecting this invitation, please ignore this email.</p>
            </div>
          </div>
        `,
        undefined,
        senderName
      );

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
