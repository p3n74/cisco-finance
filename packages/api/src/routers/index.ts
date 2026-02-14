import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { accountEditorProcedure, budgetEditorProcedure, cashflowEditorProcedure, protectedProcedure, publicProcedure, receiptEditorProcedure, router, whitelistedProcedure } from "../index";
import { WS_EVENTS, type WsEmitter, type Context } from "../context";
import { teamRouter } from "./team";
import { chatRouter } from "./chat";
import { presenceRouter } from "./presence";
import { sendEmail } from "../services/email";
import { checkRateLimit } from "../services/rate-limit";
import { env } from "@cisco-finance/env/server";

/** Max receipt image size: 1 MB decoded. Base64 is ~4/3 larger. Batches of 5 keep response under 5MB. */
const MAX_RECEIPT_IMAGE_BASE64_LENGTH = Math.ceil((1024 * 1024) * (4 / 3));

const ACCOUNT_OPTIONS = ["GCash", "GoTyme", "Cash", "BPI"] as const;

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

// Helper function to create activity logs and emit WebSocket event
async function logActivity(
  prisma: Context["prisma"],
  userId: string,
  action: string,
  entityType: string,
  description: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
  ws?: WsEmitter | null
) {
  await prisma.activityLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      description,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });

  // Emit activity logged event with message for toast notification
  if (ws) {
    ws.emitToUser(userId, {
      event: WS_EVENTS.ACTIVITY_LOGGED,
      action: "created",
      entityId,
      message: description,
    });
  }
}

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  
  team: teamRouter,
  chat: chatRouter,
  presence: presenceRouter,

  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),

  // Activity log
  activityLog: router({
    list: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(500).optional().default(50),
          cursor: z.string().optional(),
          dateFrom: z.string().optional(), // ISO date string for report/print
          dateTo: z.string().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 50;
        const cursor = input?.cursor;
        const dateFrom = input?.dateFrom ? new Date(input.dateFrom) : null;
        const dateTo = input?.dateTo ? new Date(input.dateTo) : null;
        const hasDateRange = dateFrom != null || dateTo != null;
        const where =
          dateFrom != null && dateTo != null
            ? { createdAt: { gte: dateFrom, lte: dateTo } }
            : dateFrom != null
              ? { createdAt: { gte: dateFrom } }
              : dateTo != null
                ? { createdAt: { lte: dateTo } }
                : undefined;
        const effectiveLimit = hasDateRange ? Math.min(limit, 500) : limit;
        const logs = await ctx.prisma.activityLog.findMany({
          take: effectiveLimit + (cursor && !hasDateRange ? 1 : 0),
          ...(cursor && !hasDateRange ? { cursor: { id: cursor }, skip: 1 } : {}),
          ...(where ? { where } : {}),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: {
            user: {
              select: { id: true, name: true, image: true },
            },
          },
        });
        const nextCursor = !hasDateRange && logs.length > effectiveLimit ? logs[effectiveLimit - 1].id : null;
        const items = logs.slice(0, effectiveLimit);
        return {
          items: items.map((log) => ({
            id: log.id,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            description: log.description,
            metadata: log.metadata ? JSON.parse(log.metadata) : null,
            createdAt: log.createdAt,
            user: log.user,
          })),
          nextCursor,
        };
      }),
  }),

  // Dashboard overview stats
  overview: router({
    stats: whitelistedProcedure.query(async ({ ctx }) => {
      const [
        totalCashflow,
        unboundReceipts,
        unverifiedTransactions,
        pendingVerificationData,
        recentActivity,
      ] = await Promise.all([
        ctx.prisma.cashflowEntry.aggregate({
          where: { isActive: true },
          _sum: { amount: true },
          _count: true,
        }),
        ctx.prisma.receiptSubmission.count({
          where: { cashflowEntryId: null },
        }),
        ctx.prisma.accountEntry.count({
          where: {
            isActive: true,
            cashflowEntry: null,
          },
        }),
        ctx.prisma.accountEntry.aggregate({
          where: {
            isActive: true,
            cashflowEntry: null,
          },
          _sum: { amount: true },
        }),
        ctx.prisma.activityLog.count({
          where: {
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

      // Get inflow/outflow
      const [inflow, outflow] = await Promise.all([
        ctx.prisma.cashflowEntry.aggregate({
          where: { isActive: true, amount: { gte: 0 } },
          _sum: { amount: true },
        }),
        ctx.prisma.cashflowEntry.aggregate({
          where: { isActive: true, amount: { lt: 0 } },
          _sum: { amount: true },
        }),
      ]);

      const netCashflow = Number(totalCashflow._sum.amount ?? 0);
      const pendingVerificationAmount = Number(pendingVerificationData._sum.amount ?? 0);

      return {
        totalTransactions: totalCashflow._count,
        netCashflow,
        totalInflow: Number(inflow._sum.amount ?? 0),
        totalOutflow: Math.abs(Number(outflow._sum.amount ?? 0)),
        pendingReceipts: unboundReceipts,
        unverifiedTransactionsCount: unverifiedTransactions,
        pendingVerificationAmount,
        projectedCashflow: netCashflow + pendingVerificationAmount,
        recentActivityCount: recentActivity,
      };
    }),
  }),

  // Public receipt submission (no auth required)
  receiptSubmission: router({
    submit: publicProcedure
      .input(
        z.object({
          submitterName: z.string().min(2, "Name must be at least 2 characters"),
          purpose: z.string().min(5, "Please describe what this receipt is for"),
          imageData: z
            .string()
            .min(1, "Please upload a receipt image")
            .max(MAX_RECEIPT_IMAGE_BASE64_LENGTH, "Image must be 1 MB or smaller"),
          imageType: z.string().min(1, "Image type is required"),
          notes: z.string().optional(),
          // Reimbursement fields
          needsReimbursement: z.boolean().optional().default(false),
          reimbursementMethod: z.enum(["cash", "online"]).optional(),
          accountType: z.enum(["gcash", "bank"]).optional(),
          accountNumber: z.string().optional(),
          accountName: z.string().optional(),
          qrCodeData: z.string().optional(),
          qrCodeType: z.string().optional(),
          contactInfo: z.string().optional(),
          contactType: z.enum(["phone", "email"]).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Rate limit by IP to prevent spam/DoS (skip if IP unknown, e.g. in tests)
        if (ctx.clientIp) {
          const allowed = checkRateLimit(ctx.clientIp);
          if (!allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Too many submissions. Please try again in 15 minutes.",
            });
          }
        }

        const submission = await ctx.prisma.receiptSubmission.create({
          data: {
            submitterName: input.submitterName,
            purpose: input.purpose,
            imageData: input.imageData,
            imageType: input.imageType,
            notes: input.notes,
            // Reimbursement fields
            needsReimbursement: input.needsReimbursement ?? false,
            reimbursementMethod: input.reimbursementMethod,
            accountType: input.accountType,
            accountNumber: input.accountNumber,
            accountName: input.accountName,
            qrCodeData: input.qrCodeData,
            qrCodeType: input.qrCodeType,
            contactInfo: input.contactInfo,
            contactType: input.contactType,
          },
        });

        // Notify Auditor via Email if not submitted by Auditor
        if (ctx.userRole !== "AUDITOR") {
          const auditorAuth = await ctx.prisma.authorizedUser.findFirst({
            where: { role: "AUDITOR" },
          });

          if (auditorAuth?.email) {
            // Try to find the user's name from the User table
            const auditorUser = await ctx.prisma.user.findUnique({
              where: { email: auditorAuth.email },
              select: { name: true },
            });

            const auditorName = auditorUser?.name || "Auditor";
            const senderName = await getSenderName(ctx.prisma);

            await sendEmail(
              auditorAuth.email,
              `[CISCO FINANCE] New Receipt Submission - ${input.submitterName}`,
              `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                  <div style="background-color: #1a365d; color: white; padding: 20px; text-align: center;">
                    <h1 style="margin: 0; font-size: 24px;">CISCO FINANCE</h1>
                  </div>
                  
                  <div style="padding: 30px; color: #333; line-height: 1.6;">
                    <p style="font-size: 16px;">Hello <strong>${auditorName}</strong>,</p>
                    <p>A new receipt has been submitted to the platform and requires your review.</p>
                    
                    <div style="background-color: #f8fafc; border-left: 4px solid #3182ce; padding: 20px; margin: 25px 0;">
                      <h3 style="margin-top: 0; color: #2c5282; font-size: 18px;">Submission Details</h3>
                      <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                          <td style="padding: 5px 0; color: #718096; width: 120px; vertical-align: top;">Submitter:</td>
                          <td style="padding: 5px 0; font-weight: 600; vertical-align: top;">${input.submitterName}</td>
                        </tr>
                        <tr>
                          <td style="padding: 5px 0; color: #718096; vertical-align: top;">Purpose:</td>
                          <td style="padding: 5px 0; font-weight: 600; vertical-align: top;">${input.purpose}</td>
                        </tr>
                        ${input.notes ? `
                        <tr>
                          <td style="padding: 5px 0; color: #718096; vertical-align: top;">Notes:</td>
                          <td style="padding: 5px 0; vertical-align: top;">${input.notes}</td>
                        </tr>` : ""}
                        <tr>
                          <td style="padding: 5px 0; color: #718096; vertical-align: top;">Reimbursement:</td>
                          <td style="padding: 5px 0; vertical-align: top;">
                            ${input.needsReimbursement ? `
                              <span style="color: #e53e3e; font-weight: bold;">YES</span>
                              <div style="font-size: 13px; color: #4a5568; margin-top: 5px; border-top: 1px dashed #e2e8f0; padding-top: 5px;">
                                <strong>Method:</strong> ${input.reimbursementMethod}<br/>
                                <strong>Account:</strong> ${input.accountName || "N/A"} (${input.accountType || "N/A"})<br/>
                                <strong>Number:</strong> ${input.accountNumber || "N/A"}<br/>
                                ${input.contactInfo ? `<strong>Contact:</strong> ${input.contactInfo} (${input.contactType || "N/A"})` : ""}
                              </div>
                            ` : "No"}
                          </td>
                        </tr>
                      </table>
                    </div>
                    
                    <div style="text-align: center; margin-top: 30px;">
                      <a href="${env.CORS_ORIGIN || "#"}" style="background-color: #3182ce; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">View in Dashboard</a>
                    </div>
                  </div>
                  
                  <div style="background-color: #f7fafc; padding: 15px; text-align: center; color: #a0aec0; font-size: 12px; border-top: 1px solid #e2e8f0;">
                    <p>This is an automated notification from the CISCO Finance System.</p>
                  </div>
                </div>
              `,
              undefined,
              senderName
            );
          }
        }

        // Emit to all users (public submission notification)
        ctx.ws?.emitToAll({
          event: WS_EVENTS.RECEIPT_UPDATED,
          action: "created",
          entityId: submission.id,
        });

        return { id: submission.id, message: "Receipt submitted successfully" };
      }),
    // Admin: list all submissions (paginated)
    list: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).optional().default(50),
          cursor: z.string().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 50;
        const cursor = input?.cursor;
        const submissions = await ctx.prisma.receiptSubmission.findMany({
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            submitterName: true,
            purpose: true,
            imageType: true,
            notes: true,
            // Reimbursement fields
            needsReimbursement: true,
            reimbursementMethod: true,
            accountType: true,
            accountNumber: true,
            accountName: true,
            contactInfo: true,
            contactType: true,
            // Binding fields
            cashflowEntryId: true,
            boundAt: true,
            boundBy: true,
            endorsedAt: true,
            endorsedBy: true,
            reimbursedAt: true,
            reimbursedBy: true,
            createdAt: true,
            cashflowEntry: {
              select: {
                id: true,
                description: true,
                amount: true,
                date: true,
              },
            },
          },
        });
        const nextCursor = submissions.length > limit ? submissions[limit - 1].id : null;
        const items = submissions.slice(0, limit);
        return {
          items: items.map((s) => ({
            ...s,
            isBound: !!s.cashflowEntryId,
            cashflowEntry: s.cashflowEntry
              ? {
                  ...s.cashflowEntry,
                  amount: Number(s.cashflowEntry.amount),
                }
              : null,
          })),
          nextCursor,
        };
      }),
    listPage: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
          search: z.string().optional(),
          statusFilter: z.enum(["all", "bound", "unbound"]).optional().default("all"),
          reimbursementFilter: z.enum(["all", "needs", "none", "reimbursed", "endorsed"]).optional().default("all"),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          dateSingle: z.string().optional(),
          dateSort: z.enum(["desc", "asc"]).default("desc"),
        })
      )
      .query(async ({ ctx, input }) => {
        const whereParts: Array<object> = [];

        if (input.search?.trim()) {
          const q = input.search.trim();
          whereParts.push({
            OR: [
              { submitterName: { contains: q, mode: "insensitive" as const } },
              { purpose: { contains: q, mode: "insensitive" as const } },
            ],
          });
        }

        if (input.statusFilter !== "all") {
          if (input.statusFilter === "bound") {
            whereParts.push({ cashflowEntryId: { not: null } });
          } else {
            whereParts.push({ cashflowEntryId: null });
          }
        }

        if (input.reimbursementFilter !== "all") {
          if (input.reimbursementFilter === "needs") {
            whereParts.push({ needsReimbursement: true });
          } else if (input.reimbursementFilter === "reimbursed") {
            whereParts.push({ reimbursedAt: { not: null } });
          } else if (input.reimbursementFilter === "endorsed") {
            whereParts.push({ endorsedAt: { not: null }, reimbursedAt: null });
          } else {
            whereParts.push({ needsReimbursement: false });
          }
        }

        if (input.dateSingle) {
          const start = new Date(input.dateSingle + "T00:00:00.000Z");
          const end = new Date(start.getTime() + 86400000);
          whereParts.push({ createdAt: { gte: start, lt: end } });
        } else if (input.dateFrom && input.dateTo) {
          whereParts.push({
            createdAt: {
              gte: new Date(input.dateFrom + "T00:00:00.000Z"),
              lte: new Date(input.dateTo + "T23:59:59.999Z"),
            },
          });
        }

        const where = whereParts.length > 0 ? { AND: whereParts } : undefined;
        const orderBy = [
          { createdAt: input.dateSort } as const,
          { id: input.dateSort } as const,
        ];

        const submissions = await ctx.prisma.receiptSubmission.findMany({
          where,
          orderBy,
          skip: input.offset,
          take: input.limit + 1,
          select: {
            id: true,
            submitterName: true,
            purpose: true,
            imageType: true,
            notes: true,
            needsReimbursement: true,
            reimbursementMethod: true,
            accountType: true,
            accountNumber: true,
            accountName: true,
            contactInfo: true,
            contactType: true,
            cashflowEntryId: true,
            boundAt: true,
            boundBy: true,
            endorsedAt: true,
            endorsedBy: true,
            reimbursedAt: true,
            reimbursedBy: true,
            createdAt: true,
            cashflowEntry: {
              select: {
                id: true,
                description: true,
                amount: true,
                date: true,
              },
            },
          },
        });

        const hasMore = submissions.length > input.limit;
        const items = submissions.slice(0, input.limit);

        return {
          items: items.map((s) => ({
            ...s,
            isBound: !!s.cashflowEntryId,
            cashflowEntry: s.cashflowEntry
              ? {
                  ...s.cashflowEntry,
                  amount: Number(s.cashflowEntry.amount),
                }
              : null,
          })),
          hasMore,
        };
      }),
    // Admin: get single submission with image
    getById: whitelistedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const submission = await ctx.prisma.receiptSubmission.findUnique({
          where: { id: input.id },
          include: {
            cashflowEntry: {
              select: {
                id: true,
                description: true,
                amount: true,
                date: true,
              },
            },
          },
        });
        if (!submission) return null;
        return {
          ...submission,
          isBound: !!submission.cashflowEntryId,
          cashflowEntry: submission.cashflowEntry
            ? {
                ...submission.cashflowEntry,
                amount: Number(submission.cashflowEntry.amount),
              }
            : null,
        };
      }),
    // Bind receipt to a cashflow entry
    bind: receiptEditorProcedure
      .input(
        z.object({
          id: z.string(),
          cashflowEntryId: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [receipt, cashflow] = await Promise.all([
          ctx.prisma.receiptSubmission.findUnique({ where: { id: input.id } }),
          ctx.prisma.cashflowEntry.findUnique({ where: { id: input.cashflowEntryId } }),
        ]);
        
        const result = await ctx.prisma.receiptSubmission.update({
          where: { id: input.id },
          data: {
            cashflowEntryId: input.cashflowEntryId,
            boundAt: new Date(),
            boundBy: ctx.session.user.id,
          },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "bound",
          "receipt_submission",
          `bound receipt from ${receipt?.submitterName} to "${cashflow?.description}"`,
          input.id,
          { cashflowEntryId: input.cashflowEntryId, purpose: receipt?.purpose },
          ctx.ws
        );

        // Emit receipt and cashflow updates
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.RECEIPT_UPDATED,
          action: "bound",
          entityId: input.id,
        });
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.CASHFLOW_UPDATED,
          action: "updated",
          entityId: input.cashflowEntryId,
        });
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.STATS_UPDATED,
          action: "updated",
        });

        return result;
      }),
    // Unbind receipt from cashflow entry
    unbind: receiptEditorProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const receipt = await ctx.prisma.receiptSubmission.findUnique({
          where: { id: input.id },
          include: { cashflowEntry: { select: { id: true, description: true } } },
        });

        const cashflowEntryId = receipt?.cashflowEntry?.id;

        const result = await ctx.prisma.receiptSubmission.update({
          where: { id: input.id },
          data: {
            cashflowEntryId: null,
            boundAt: null,
            boundBy: null,
          },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "unbound",
          "receipt_submission",
          `unbound receipt from ${receipt?.submitterName} from "${receipt?.cashflowEntry?.description}"`,
          input.id,
          { purpose: receipt?.purpose },
          ctx.ws
        );

        // Emit receipt and cashflow updates
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.RECEIPT_UPDATED,
          action: "unbound",
          entityId: input.id,
        });
        if (cashflowEntryId) {
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.CASHFLOW_UPDATED,
            action: "updated",
            entityId: cashflowEntryId,
          });
        }
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.STATS_UPDATED,
          action: "updated",
        });

        return result;
      }),
    // Count unbound submissions
    countUnbound: whitelistedProcedure.query(async ({ ctx }) => {
      const count = await ctx.prisma.receiptSubmission.count({
        where: { cashflowEntryId: null },
      });
      return { count };
    }),
    // List unbound submissions (for binding dialog)
    listUnbound: whitelistedProcedure.query(async ({ ctx }) => {
      const submissions = await ctx.prisma.receiptSubmission.findMany({
        where: { cashflowEntryId: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          submitterName: true,
          purpose: true,
          createdAt: true,
        },
      });
      return submissions;
    }),
    // Submit and bind in one operation (for direct upload from transaction)
    submitAndBind: receiptEditorProcedure
      .input(
        z.object({
          submitterName: z.string().min(2, "Name must be at least 2 characters"),
          purpose: z.string().min(5, "Please describe what this receipt is for"),
          imageData: z
            .string()
            .min(1, "Please upload a receipt image")
            .max(MAX_RECEIPT_IMAGE_BASE64_LENGTH, "Image must be 1 MB or smaller"),
          imageType: z.string().min(1, "Image type is required"),
          notes: z.string().optional(),
          cashflowEntryId: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const cashflow = await ctx.prisma.cashflowEntry.findUnique({
          where: { id: input.cashflowEntryId },
        });

        const submission = await ctx.prisma.receiptSubmission.create({
          data: {
            submitterName: input.submitterName,
            purpose: input.purpose,
            imageData: input.imageData,
            imageType: input.imageType,
            notes: input.notes,
            cashflowEntryId: input.cashflowEntryId,
            boundAt: new Date(),
            boundBy: ctx.session.user.id,
          },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "uploaded",
          "receipt_submission",
          `uploaded and bound receipt for "${input.purpose}" to "${cashflow?.description}"`,
          submission.id,
          { cashflowEntryId: input.cashflowEntryId, purpose: input.purpose },
          ctx.ws
        );

        // Emit receipt and cashflow updates
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.RECEIPT_UPDATED,
          action: "created",
          entityId: submission.id,
        });
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.CASHFLOW_UPDATED,
          action: "updated",
          entityId: input.cashflowEntryId,
        });
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.STATS_UPDATED,
          action: "updated",
        });

        return { id: submission.id, message: "Receipt uploaded and bound successfully" };
      }),
    // Endorse for reimbursement (notify treasurer)
    endorse: receiptEditorProcedure
      .input(z.object({ 
        id: z.string(),
        message: z.string().optional()
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.userRole !== "AUDITOR" && ctx.userRole !== "VP_FINANCE") {
          throw new Error("Only the Auditor or VP Finance can endorse receipts for reimbursement.");
        }

        const submission = await ctx.prisma.receiptSubmission.findUnique({
          where: { id: input.id },
        });

        if (!submission) {
          throw new Error("Receipt submission not found");
        }

        const treasurerAuth = await ctx.prisma.authorizedUser.findFirst({
          where: { role: "TREASURER" },
        });

        if (!treasurerAuth?.email) {
          throw new Error("Treasurer email not found. Please ensure a treasurer is configured.");
        }

        // Try to find the treasurer's name
        const treasurerUser = await ctx.prisma.user.findUnique({
          where: { email: treasurerAuth.email },
          select: { name: true },
        });

        const treasurerName = treasurerUser?.name || "Treasurer";
        const senderName = await getSenderName(ctx.prisma);

        // Update database record
        await ctx.prisma.receiptSubmission.update({
          where: { id: input.id },
          data: {
            endorsedAt: new Date(),
            endorsedBy: ctx.session.user.id,
          },
        });

        // Prepare attachments
        const attachments = [];
        let qrCodeHtml = "";

        if (submission.qrCodeData && submission.qrCodeType) {
          attachments.push({
            filename: `qrcode.${submission.qrCodeType.split("/")[1]}`,
            content: submission.qrCodeData,
            encoding: "base64",
            cid: "qrcode", // referenced in the HTML
          });
          
          qrCodeHtml = `
            <div style="text-align: center; margin: 20px 0;">
              <p style="font-size: 14px; color: #718096; margin-bottom: 10px;">Payment QR Code:</p>
              <img src="cid:qrcode" alt="QR Code" style="max-width: 200px; border: 1px solid #ddd; padding: 5px; border-radius: 5px;" />
            </div>`;
        }

        // Send email
        await sendEmail(
          treasurerAuth.email,
          `[CISCO FINANCE] Reimbursement Endorsement - ${submission.submitterName}`,
          `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
              <div style="background-color: #1a365d; color: white; padding: 20px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">CISCO FINANCE</h1>
              </div>
              
              <div style="padding: 30px; color: #333; line-height: 1.6;">
                <p style="font-size: 16px;">Hello <strong>${treasurerName}</strong>,</p>
                <p>A receipt has been endorsed for reimbursement by <strong>${ctx.session.user.name}</strong>.</p>
                
                ${input.message ? `
                <div style="background-color: #fffaf0; border-left: 4px solid #ed8936; padding: 15px; margin: 20px 0; font-style: italic; color: #744210;">
                  "${input.message}"
                </div>` : ""}

                <div style="background-color: #f0fff4; border-left: 4px solid #38a169; padding: 20px; margin: 25px 0;">
                  <h3 style="margin-top: 0; color: #22543d; font-size: 18px;">Payment Details</h3>
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 5px 0; color: #718096; width: 120px; vertical-align: top;">Payee:</td>
                      <td style="padding: 5px 0; font-weight: 600; vertical-align: top;">${submission.submitterName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 5px 0; color: #718096; vertical-align: top;">Purpose:</td>
                      <td style="padding: 5px 0; font-weight: 600; vertical-align: top;">${submission.purpose}</td>
                    </tr>
                    <tr>
                      <td style="padding: 5px 0; color: #718096; vertical-align: top;">Method:</td>
                      <td style="padding: 5px 0; vertical-align: top;">${submission.reimbursementMethod || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style="padding: 5px 0; color: #718096; vertical-align: top;">Account:</td>
                      <td style="padding: 5px 0; vertical-align: top;">
                        ${submission.accountName || "N/A"} (${submission.accountType || "N/A"})<br/>
                        <span style="font-family: monospace; background: #eee; padding: 2px 4px; border-radius: 3px;">${submission.accountNumber || "N/A"}</span>
                      </td>
                    </tr>
                    ${submission.contactInfo ? `
                    <tr>
                      <td style="padding: 5px 0; color: #718096; vertical-align: top;">Contact:</td>
                      <td style="padding: 5px 0; vertical-align: top;">${submission.contactInfo} (${submission.contactType || "N/A"})</td>
                    </tr>` : ""}
                  </table>
                </div>

                ${qrCodeHtml}
                
                <div style="text-align: center; margin-top: 30px;">
                  <a href="${env.CORS_ORIGIN || "#"}" style="background-color: #38a169; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">View in Dashboard</a>
                </div>
              </div>
              
              <div style="background-color: #f7fafc; padding: 15px; text-align: center; color: #a0aec0; font-size: 12px; border-top: 1px solid #e2e8f0;">
                <p>This endorsement was officially triggered by ${ctx.session.user.name}.</p>
              </div>
            </div>
          `,
          attachments,
          senderName
        );

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "endorsed",
          "receipt_submission",
          `endorsed reimbursement for "${submission.purpose}" to ${submission.submitterName}`,
          submission.id,
          { treasurerEmail: treasurerAuth.email, message: input.message },
          ctx.ws
        );

        return { success: true, message: "Endorsement sent to treasurer" };
      }),
    // Mark receipt as reimbursed (Treasurer only) — receiptEditorProcedure gates access; Treasurer check is inside
    markAsReimbursed: receiptEditorProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.userRole !== "TREASURER") {
          throw new Error("Only the Treasurer can mark receipts as reimbursed");
        }

        const submission = await ctx.prisma.receiptSubmission.findUnique({
          where: { id: input.id },
        });

        if (!submission) {
          throw new Error("Receipt submission not found");
        }

        if (!submission.endorsedAt) {
          throw new Error("This receipt has not been endorsed yet. It must be endorsed by the Auditor or VP Finance first.");
        }

        const updatedSubmission = await ctx.prisma.receiptSubmission.update({
          where: { id: input.id },
          data: {
            reimbursedAt: new Date(),
            reimbursedBy: ctx.session.user.id,
          },
        });

        const senderName = await getSenderName(ctx.prisma);

        // Notify Auditor
        const auditorAuth = await ctx.prisma.authorizedUser.findFirst({
          where: { role: "AUDITOR" },
        });

        if (auditorAuth?.email) {
          const auditorUser = await ctx.prisma.user.findUnique({
            where: { email: auditorAuth.email },
            select: { name: true },
          });
          const auditorName = auditorUser?.name || "Auditor";

          await sendEmail(
            auditorAuth.email,
            `[CISCO FINANCE] Reimbursement Processed - ${updatedSubmission.submitterName}`,
            `
              <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #1a365d; color: white; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 24px;">CISCO FINANCE</h1>
                </div>
                
                <div style="padding: 30px; color: #333; line-height: 1.6;">
                  <p style="font-size: 16px;">Hello <strong>${auditorName}</strong>,</p>
                  <p>The reimbursement for <strong>${updatedSubmission.submitterName}</strong> has been marked as <strong>COMPLETED</strong> by the Treasurer.</p>
                  
                  <div style="background-color: #f3e8ff; border-left: 4px solid #805ad5; padding: 20px; margin: 25px 0;">
                    <h3 style="margin-top: 0; color: #553c9a; font-size: 18px;">Transaction Completed</h3>
                    <p style="margin: 5px 0;"><strong>Purpose:</strong> ${updatedSubmission.purpose}</p>
                    <p style="margin: 5px 0;"><strong>Processed By:</strong> ${ctx.session.user.name}</p>
                    <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                  </div>
                  
                  <div style="text-align: center; margin-top: 30px;">
                    <a href="${env.CORS_ORIGIN || "#"}" style="background-color: #805ad5; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">View in Dashboard</a>
                  </div>
                </div>
                
                <div style="background-color: #f7fafc; padding: 15px; text-align: center; color: #a0aec0; font-size: 12px; border-top: 1px solid #e2e8f0;">
                  <p>This is an automated notification from the CISCO Finance System.</p>
                </div>
              </div>
            `,
            undefined,
            senderName
          );
        }

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "reimbursed",
          "receipt_submission",
          `marked receipt from ${updatedSubmission.submitterName} as reimbursed`,
          updatedSubmission.id,
          { purpose: updatedSubmission.purpose },
          ctx.ws
        );

        // Emit update
        ctx.ws?.emitToAll({
          event: WS_EVENTS.RECEIPT_UPDATED,
          action: "updated",
          entityId: updatedSubmission.id,
        });

        return { success: true };
      }),
  }),

  // Account entries (treasury ledger)
  accountEntries: router({
    list: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).optional().default(50),
          cursor: z.string().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 50;
        const cursor = input?.cursor;
        const entries = await ctx.prisma.accountEntry.findMany({
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ date: "desc" }, { id: "desc" }],
          include: {
            cashflowEntry: {
              select: { id: true, description: true },
            },
          },
        });
        const nextCursor = entries.length > limit ? entries[limit - 1].id : null;
        const items = entries.slice(0, limit);
        return {
          items: items.map((entry) => ({
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
          })),
          nextCursor,
        };
      }),
    listPage: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
          search: z.string().optional(),
          accountFilter: z.enum(["all", ...ACCOUNT_OPTIONS]).optional().default("all"),
          statusFilter: z.enum(["all", "verified", "unverified", "archived"]).optional().default("all"),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          dateSingle: z.string().optional(),
          dateSort: z.enum(["desc", "asc"]).default("desc"),
        })
      )
      .query(async ({ ctx, input }) => {
        const whereParts: Array<object> = [];

        if (input.search?.trim()) {
          const q = input.search.trim();
          whereParts.push({
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              ...(q && !Number.isNaN(Number(q)) ? [{ amount: Number(q) }] : []),
            ],
          });
        }

        if (input.accountFilter !== "all") {
          whereParts.push({ account: input.accountFilter });
        }

        if (input.statusFilter !== "all") {
          if (input.statusFilter === "verified") {
            whereParts.push({ cashflowEntry: { isNot: null } });
          } else if (input.statusFilter === "unverified") {
            whereParts.push({ cashflowEntry: null, isActive: true });
          } else if (input.statusFilter === "archived") {
            whereParts.push({ isActive: false });
          }
        }

        if (input.dateSingle) {
          const start = new Date(input.dateSingle + "T00:00:00.000Z");
          const end = new Date(start.getTime() + 86400000);
          whereParts.push({ date: { gte: start, lt: end } });
        } else if (input.dateFrom && input.dateTo) {
          whereParts.push({
            date: {
              gte: new Date(input.dateFrom + "T00:00:00.000Z"),
              lte: new Date(input.dateTo + "T23:59:59.999Z"),
            },
          });
        }

        const where = whereParts.length > 0 ? { AND: whereParts } : undefined;
        const orderBy = [
          { date: input.dateSort } as const,
          { id: input.dateSort } as const,
        ];

        const entries = await ctx.prisma.accountEntry.findMany({
          where,
          orderBy,
          skip: input.offset,
          take: input.limit + 1,
          include: {
            cashflowEntry: {
              select: { id: true, description: true },
            },
          },
        });

        const hasMore = entries.length > input.limit;
        const items = entries.slice(0, input.limit);

        return {
          items: items.map((entry) => ({
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
          })),
          hasMore,
        };
      }),
    listUnverified: whitelistedProcedure.query(async ({ ctx }) => {
      const entries = await ctx.prisma.accountEntry.findMany({
        where: {
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
    create: accountEditorProcedure
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
        const entry = await ctx.prisma.accountEntry.create({
          data: {
            date: input.date,
            description: input.description,
            account: input.account,
            amount: input.amount,
            currency: input.currency ?? "PHP",
            notes: input.notes,
            user: {
              connect: { id: ctx.session.user.id }
            }
          },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "created",
          "account_entry",
          `added ${input.account} transaction "${input.description}" for ${input.amount >= 0 ? "+" : ""}${input.amount}`,
          entry.id,
          { account: input.account, amount: input.amount },
          ctx.ws
        );

        // Emit account entry update
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.ACCOUNT_ENTRY_UPDATED,
          action: "created",
          entityId: entry.id,
        });
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.STATS_UPDATED,
          action: "updated",
        });

        return entry;
      }),
    update: accountEditorProcedure
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
          },
          data: {
            date: input.date,
            description: input.description,
            account: input.account,
            amount: input.amount,
          },
        });

        if (result.count > 0) {
          // Emit account entry update
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.ACCOUNT_ENTRY_UPDATED,
            action: "updated",
            entityId: input.id,
          });
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.STATS_UPDATED,
            action: "updated",
          });
        }

        return { updated: result.count };
      }),
    archive: accountEditorProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const entry = await ctx.prisma.accountEntry.findUnique({
          where: { id: input.id },
          include: { cashflowEntry: true },
        });

        if (entry?.cashflowEntry) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot archive: this entry is linked to a verified transaction.",
          });
        }

        const result = await ctx.prisma.accountEntry.updateMany({
          where: {
            id: input.id,
          },
          data: {
            isActive: false,
            archivedAt: new Date(),
          },
        });

        if (result.count > 0) {
          await logActivity(
            ctx.prisma,
            ctx.session.user.id,
            "archived",
            "account_entry",
            `archived ${entry?.account} transaction "${entry?.description}"`,
            input.id,
            undefined,
            ctx.ws
          );

          // Emit account entry update
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.ACCOUNT_ENTRY_UPDATED,
            action: "archived",
            entityId: input.id,
          });
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.STATS_UPDATED,
            action: "updated",
          });
        }

        return { updated: result.count };
      }),
  }),

  // Budget Planning
  budgetProjects: router({
    // List all projects for user (paginated)
    list: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(50).optional().default(20),
          cursor: z.string().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 20;
        const cursor = input?.cursor;
        const projects = await ctx.prisma.budgetProject.findMany({
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          where: {
            isActive: true,
          },
          orderBy: [
            { status: "asc" }, // planned first, then completed
            { eventDate: "asc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          include: {
            items: {
              where: { isActive: true },
              include: {
                expenses: {
                  include: {
                    cashflowEntry: {
                      select: {
                        id: true,
                        amount: true,
                        description: true,
                        date: true,
                        lineItems: {
                          select: { id: true, description: true, category: true, amount: true },
                          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                        },
                      },
                    },
                  },
                },
                incomes: {
                  include: {
                    cashflowEntry: {
                      select: {
                        id: true,
                        amount: true,
                        description: true,
                        date: true,
                        lineItems: {
                          select: { id: true, description: true, category: true, amount: true },
                          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        const nextCursor = projects.length > limit ? projects[limit - 1].id : null;
        const items = projects.slice(0, limit);
        return {
          items: items.map((project) => {
            const totalBudget = project.items
              .filter((i) => i.type === "expense")
              .reduce((sum, item) => sum + Number(item.estimatedAmount), 0);
            const totalIncomeBudget = project.items
              .filter((i) => i.type === "income")
              .reduce((sum, item) => sum + Number(item.estimatedAmount), 0);
            const totalActual = project.items.reduce(
              (sum, item) =>
                sum +
                item.expenses.reduce(
                  (expSum, exp) => expSum + Math.abs(Number(exp.cashflowEntry.amount)),
                  0
                ),
              0
            );
            const totalActualIncome = project.items.reduce(
              (sum, item) =>
                sum +
                item.incomes.reduce(
                  (incSum, inc) => incSum + Number(inc.cashflowEntry.amount),
                  0
                ),
              0
            );

            return {
              id: project.id,
              name: project.name,
              description: project.description,
              category: project.category,
              eventDate: project.eventDate,
              status: project.status,
              isActive: project.isActive,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              totalBudget,
              totalIncomeBudget,
              totalActual,
              totalActualIncome,
              itemCount: project.items.length,
              items: project.items.map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description,
                type: item.type,
                estimatedAmount: Number(item.estimatedAmount),
                notes: item.notes,
                isActive: item.isActive,
                createdAt: item.createdAt,
                actualAmount:
                  item.type === "expense"
                    ? item.expenses.reduce(
                        (sum, exp) => sum + Math.abs(Number(exp.cashflowEntry.amount)),
                        0
                      )
                    : item.incomes.reduce(
                        (sum, inc) => sum + Number(inc.cashflowEntry.amount),
                        0
                      ),
                expenseCount: item.expenses.length,
                incomeCount: item.incomes.length,
                expenses: item.expenses.map((exp) => {
                  const ce = exp.cashflowEntry as typeof exp.cashflowEntry & {
                    lineItems?: { id: string; description: string; category: string; amount: unknown }[];
                  };
                  return {
                    id: exp.id,
                    cashflowEntryId: exp.cashflowEntryId,
                    cashflowEntry: {
                      ...exp.cashflowEntry,
                      amount: Number(exp.cashflowEntry.amount),
                      lineItems: ce.lineItems?.map((li) => ({
                        id: li.id,
                        description: li.description,
                        category: li.category,
                        amount: Number(li.amount),
                      })) ?? [],
                    },
                    createdAt: exp.createdAt,
                  };
                }),
                incomes: item.incomes.map((inc) => {
                  const ce = inc.cashflowEntry as typeof inc.cashflowEntry & {
                    lineItems?: { id: string; description: string; category: string; amount: unknown }[];
                  };
                  return {
                    id: inc.id,
                    cashflowEntryId: inc.cashflowEntryId,
                    cashflowEntry: {
                      ...inc.cashflowEntry,
                      amount: Number(inc.cashflowEntry.amount),
                      lineItems: ce.lineItems?.map((li) => ({
                        id: li.id,
                        description: li.description,
                        category: li.category,
                        amount: Number(li.amount),
                      })) ?? [],
                    },
                    createdAt: inc.createdAt,
                  };
                }),
              })),
            };
          }),
          nextCursor,
        };
      }),

    // Get single project by ID
    getById: whitelistedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const project = await ctx.prisma.budgetProject.findFirst({
          where: {
            id: input.id,
          },
          include: {
            items: {
              where: { isActive: true },
              orderBy: { createdAt: "asc" },
              include: {
                expenses: {
                  include: {
                    cashflowEntry: {
                      select: {
                        id: true,
                        amount: true,
                        description: true,
                        date: true,
                        category: true,
                        accountEntry: {
                          select: { id: true, account: true, description: true },
                        },
                        lineItems: {
                          select: { id: true, description: true, category: true, amount: true },
                          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                        },
                      },
                    },
                  },
                },
                incomes: {
                  include: {
                    cashflowEntry: {
                      select: {
                        id: true,
                        amount: true,
                        description: true,
                        date: true,
                        category: true,
                        accountEntry: {
                          select: { id: true, account: true, description: true },
                        },
                        lineItems: {
                          select: { id: true, description: true, category: true, amount: true },
                          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!project) return null;

        const totalBudget = project.items
          .filter((i) => i.type === "expense")
          .reduce((sum, item) => sum + Number(item.estimatedAmount), 0);
        const totalIncomeBudget = project.items
          .filter((i) => i.type === "income")
          .reduce((sum, item) => sum + Number(item.estimatedAmount), 0);
        const totalActual = project.items.reduce(
          (sum, item) =>
            sum +
            item.expenses.reduce(
              (expSum, exp) => expSum + Math.abs(Number(exp.cashflowEntry.amount)),
              0
            ),
          0
        );
        const totalActualIncome = project.items.reduce(
          (sum, item) =>
            sum +
            item.incomes.reduce(
              (incSum, inc) => incSum + Number(inc.cashflowEntry.amount),
              0
            ),
          0
        );

        return {
          id: project.id,
          name: project.name,
          description: project.description,
          category: project.category,
          eventDate: project.eventDate,
          status: project.status,
          isActive: project.isActive,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          totalBudget,
          totalIncomeBudget,
          totalActual,
          totalActualIncome,
          items: project.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            type: item.type,
            estimatedAmount: Number(item.estimatedAmount),
            notes: item.notes,
            isActive: item.isActive,
            createdAt: item.createdAt,
            actualAmount:
              item.type === "expense"
                ? item.expenses.reduce(
                    (sum, exp) => sum + Math.abs(Number(exp.cashflowEntry.amount)),
                    0
                  )
                : item.incomes.reduce(
                    (sum, inc) => sum + Number(inc.cashflowEntry.amount),
                    0
                  ),
            expenseCount: item.expenses.length,
            incomeCount: item.incomes.length,
            expenses: item.expenses.map((exp) => ({
              id: exp.id,
              cashflowEntryId: exp.cashflowEntryId,
              cashflowEntry: {
                ...exp.cashflowEntry,
                amount: Number(exp.cashflowEntry.amount),
                lineItems: exp.cashflowEntry.lineItems?.map((li) => ({
                  id: li.id,
                  description: li.description,
                  category: li.category,
                  amount: Number(li.amount),
                })) ?? [],
              },
              createdAt: exp.createdAt,
            })),
            incomes: item.incomes.map((inc) => ({
              id: inc.id,
              cashflowEntryId: inc.cashflowEntryId,
              cashflowEntry: {
                ...inc.cashflowEntry,
                amount: Number(inc.cashflowEntry.amount),
                lineItems: inc.cashflowEntry.lineItems?.map((li) => ({
                  id: li.id,
                  description: li.description,
                  category: li.category,
                  amount: Number(li.amount),
                })) ?? [],
              },
              createdAt: inc.createdAt,
            })),
          })),
        };
      }),

    // Create new project
    create: budgetEditorProcedure
      .input(
        z.object({
          name: z.string().min(2, "Name must be at least 2 characters"),
          description: z.string().optional(),
          category: z.string().optional(),
          eventDate: z.coerce.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const project = await ctx.prisma.budgetProject.create({
          data: {
            userId: ctx.session.user.id,
            name: input.name,
            description: input.description,
            category: input.category,
            eventDate: input.eventDate,
          },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "created",
          "budget_project",
          `created budget project "${input.name}"`,
          project.id,
          { category: input.category },
          ctx.ws
        );

        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.STATS_UPDATED,
          action: "updated",
        });

        return project;
      }),

    // Update project
    update: budgetEditorProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(2).optional(),
          description: z.string().optional(),
          category: z.string().optional(),
          eventDate: z.coerce.date().optional().nullable(),
          status: z.enum(["planned", "completed"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const result = await ctx.prisma.budgetProject.updateMany({
          where: {
            id,
          },
          data,
        });

        if (result.count > 0 && input.status) {
          await logActivity(
            ctx.prisma,
            ctx.session.user.id,
            input.status === "completed" ? "completed" : "updated",
            "budget_project",
            input.status === "completed"
              ? `marked budget project as completed`
              : `updated budget project`,
            id,
            undefined,
            ctx.ws
          );
        }

        return { updated: result.count };
      }),

    // Archive project
    archive: budgetEditorProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const project = await ctx.prisma.budgetProject.findFirst({
          where: { id: input.id },
        });

        const result = await ctx.prisma.budgetProject.updateMany({
          where: {
            id: input.id,
          },
          data: {
            isActive: false,
            archivedAt: new Date(),
          },
        });

        if (result.count > 0) {
          await logActivity(
            ctx.prisma,
            ctx.session.user.id,
            "archived",
            "budget_project",
            `archived budget project "${project?.name}"`,
            input.id,
            undefined,
            ctx.ws
          );
        }

        return { updated: result.count };
      }),

    // Get overview stats for dashboard
    overview: whitelistedProcedure.query(async ({ ctx }) => {
      const projects = await ctx.prisma.budgetProject.findMany({
        where: {
          isActive: true,
        },
        include: {
          items: {
            where: { isActive: true },
            include: {
              expenses: {
                include: {
                  cashflowEntry: { select: { amount: true } },
                },
              },
              incomes: {
                include: {
                  cashflowEntry: { select: { amount: true } },
                },
              },
            },
          },
        },
      });

      const plannedProjects = projects.filter((p) => p.status === "planned");
      const completedProjects = projects.filter((p) => p.status === "completed");

      // Reserved for projected cashflow: only planned events, and only remaining budget
      // (planned - actual) so we don't double-count: actual spend is already in net cashflow
      const reservedForPlanned = plannedProjects.reduce((sum, p) => {
        const budget = p.items
          .filter((i) => i.type === "expense")
          .reduce((iSum, item) => iSum + Number(item.estimatedAmount), 0);
        const actual = p.items.reduce(
          (iSum, item) =>
            iSum +
            item.expenses.reduce(
              (eSum, exp) => eSum + Math.abs(Number(exp.cashflowEntry.amount)),
              0
            ),
          0
        );
        return sum + Math.max(0, budget - actual);
      }, 0);

      const totalBudget = projects.reduce(
        (sum, p) =>
          sum +
          p.items
            .filter((i) => i.type === "expense")
            .reduce((iSum, item) => iSum + Number(item.estimatedAmount), 0),
        0
      );
      const totalIncomeBudget = projects.reduce(
        (sum, p) =>
          sum +
          p.items
            .filter((i) => i.type === "income")
            .reduce((iSum, item) => iSum + Number(item.estimatedAmount), 0),
        0
      );

      const totalActual = projects.reduce(
        (sum, p) =>
          sum +
          p.items.reduce(
            (iSum, item) =>
              iSum +
              item.expenses.reduce(
                (eSum, exp) => eSum + Math.abs(Number(exp.cashflowEntry.amount)),
                0
              ),
            0
          ),
        0
      );
      const totalActualIncome = projects.reduce(
        (sum, p) =>
          sum +
          p.items.reduce(
            (iSum, item) =>
              iSum +
              item.incomes.reduce(
                (iIncSum, inc) => iIncSum + Number(inc.cashflowEntry.amount),
                0
              ),
            0
          ),
        0
      );

      // Find upcoming events (planned projects with event dates in the future)
      const now = new Date();
      const upcomingEvents = plannedProjects
        .filter((p) => p.eventDate && new Date(p.eventDate) >= now)
        .sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime())
        .slice(0, 3)
        .map((p) => ({
          id: p.id,
          name: p.name,
          eventDate: p.eventDate,
          category: p.category,
        }));

      return {
        totalProjects: projects.length,
        plannedCount: plannedProjects.length,
        completedCount: completedProjects.length,
        totalBudget,
        totalIncomeBudget,
        totalActual,
        totalActualIncome,
        reservedForPlanned,
        upcomingEvents,
      };
    }),
  }),

  // Budget Items
  budgetItems: router({
    // Create new item in a project
    create: budgetEditorProcedure
      .input(
        z.object({
          budgetProjectId: z.string(),
          name: z.string().min(2, "Name must be at least 2 characters"),
          description: z.string().optional(),
          type: z.enum(["expense", "income"]).optional().default("expense"),
          estimatedAmount: z.coerce.number().min(0, "Amount must be positive"),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Verify project exists
        const project = await ctx.prisma.budgetProject.findFirst({
          where: {
            id: input.budgetProjectId,
          },
        });

        if (!project) {
          throw new Error("Project not found");
        }

        const item = await ctx.prisma.budgetItem.create({
          data: {
            budgetProjectId: input.budgetProjectId,
            name: input.name,
            description: input.description,
            type: input.type,
            estimatedAmount: input.estimatedAmount,
            notes: input.notes,
          },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "created",
          "budget_item",
          `added budget item "${input.name}" (${input.estimatedAmount}) to "${project.name}"`,
          item.id,
          { projectId: input.budgetProjectId, amount: input.estimatedAmount },
          ctx.ws
        );

        return item;
      }),

    // Update item
    update: budgetEditorProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(2).optional(),
          description: z.string().optional(),
          type: z.enum(["expense", "income"]).optional(),
          estimatedAmount: z.coerce.number().min(0).optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Verify item exists
        const item = await ctx.prisma.budgetItem.findFirst({
          where: { id: input.id },
        });

        if (!item) {
          throw new Error("Item not found");
        }

        const { id, ...data } = input;
        return ctx.prisma.budgetItem.update({
          where: { id },
          data,
        });
      }),

    // Delete item (only if no linked expenses or incomes)
    delete: budgetEditorProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // Verify item exists
        const item = await ctx.prisma.budgetItem.findFirst({
          where: { id: input.id },
          include: {
            budgetProject: { select: { name: true } },
            expenses: { select: { id: true } },
            incomes: { select: { id: true } },
          },
        });

        if (!item) {
          throw new Error("Item not found");
        }

        if (item.expenses.length > 0) {
          throw new Error(
            "Cannot delete budget item with linked expenses. Unlink all expenses first."
          );
        }
        if (item.incomes.length > 0) {
          throw new Error(
            "Cannot delete budget item with linked income. Unlink all income first."
          );
        }

        await ctx.prisma.budgetItem.delete({
          where: { id: input.id },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "deleted",
          "budget_item",
          `deleted budget item "${item.name}" from "${item.budgetProject.name}"`,
          input.id,
          undefined,
          ctx.ws
        );

        return { deleted: true };
      }),

    // Link cashflow entry to budget item
    linkExpense: budgetEditorProcedure
      .input(
        z.object({
          budgetItemId: z.string(),
          cashflowEntryId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Verify budget item exists
        const item = await ctx.prisma.budgetItem.findFirst({
          where: { id: input.budgetItemId },
          include: {
            budgetProject: { select: { name: true } },
          },
        });

        if (!item) {
          throw new Error("Budget item not found");
        }

        // Verify cashflow entry exists
        const cashflow = await ctx.prisma.cashflowEntry.findFirst({
          where: {
            id: input.cashflowEntryId,
          },
        });

        if (!cashflow) {
          throw new Error("Cashflow entry not found");
        }

        const expense = await ctx.prisma.budgetItemExpense.create({
          data: {
            budgetItemId: input.budgetItemId,
            cashflowEntryId: input.cashflowEntryId,
          },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "linked",
          "budget_item_expense",
          `linked "${cashflow.description}" to budget item "${item.name}"`,
          expense.id,
          { budgetItemId: input.budgetItemId, cashflowEntryId: input.cashflowEntryId },
          ctx.ws
        );

        return expense;
      }),

    // Unlink expense from budget item
    unlinkExpense: budgetEditorProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // Verify expense exists
        const expense = await ctx.prisma.budgetItemExpense.findFirst({
          where: { id: input.id },
          include: {
            budgetItem: true,
            cashflowEntry: { select: { description: true } },
          },
        });

        if (!expense) {
          throw new Error("Expense link not found");
        }

        await ctx.prisma.budgetItemExpense.delete({
          where: { id: input.id },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "unlinked",
          "budget_item_expense",
          `unlinked "${expense.cashflowEntry.description}" from budget item "${expense.budgetItem.name}"`,
          input.id,
          undefined,
          ctx.ws
        );

        return { deleted: true };
      }),

    // Link income cashflow entry to budget item (income type)
    linkIncome: budgetEditorProcedure
      .input(
        z.object({
          budgetItemId: z.string(),
          cashflowEntryId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const item = await ctx.prisma.budgetItem.findFirst({
          where: { id: input.budgetItemId },
          include: { budgetProject: { select: { name: true } } },
        });
        if (!item) throw new Error("Budget item not found");
        if (item.type !== "income") {
          throw new Error("Only income-type budget items can link income. Change item type to Income first.");
        }

        const cashflow = await ctx.prisma.cashflowEntry.findFirst({
          where: { id: input.cashflowEntryId },
        });
        if (!cashflow) throw new Error("Cashflow entry not found");
        if (Number(cashflow.amount) <= 0) {
          throw new Error("Only positive (inflow) cashflow entries can be linked as income.");
        }

        const income = await ctx.prisma.budgetItemIncome.create({
          data: {
            budgetItemId: input.budgetItemId,
            cashflowEntryId: input.cashflowEntryId,
          },
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "linked",
          "budget_item_income",
          `linked income "${cashflow.description}" to budget item "${item.name}"`,
          income.id,
          { budgetItemId: input.budgetItemId, cashflowEntryId: input.cashflowEntryId },
          ctx.ws
        );

        return income;
      }),

    // Unlink income from budget item
    unlinkIncome: budgetEditorProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const income = await ctx.prisma.budgetItemIncome.findFirst({
          where: { id: input.id },
          include: {
            budgetItem: true,
            cashflowEntry: { select: { description: true } },
          },
        });
        if (!income) throw new Error("Income link not found");

        await ctx.prisma.budgetItemIncome.delete({ where: { id: input.id } });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "unlinked",
          "budget_item_income",
          `unlinked "${income.cashflowEntry.description}" from budget item "${income.budgetItem.name}"`,
          input.id,
          undefined,
          ctx.ws
        );

        return { deleted: true };
      }),

    // Get unlinked cashflow entries (for linking dropdown). Pass itemType to filter: expense = outflows, income = inflows.
    getUnlinkedCashflows: whitelistedProcedure
      .input(
        z.object({
          budgetItemId: z.string(),
          itemType: z.enum(["expense", "income"]).optional().default("expense"),
        })
      )
      .query(async ({ ctx, input }) => {
        if (input.itemType === "income") {
          const linkedIncomes = await ctx.prisma.budgetItemIncome.findMany({
            where: { budgetItemId: input.budgetItemId },
            select: { cashflowEntryId: true },
          });
          const linkedIds = linkedIncomes.map((i) => i.cashflowEntryId);
          const cashflows = await ctx.prisma.cashflowEntry.findMany({
            where: {
              isActive: true,
              id: { notIn: linkedIds },
              amount: { gt: 0 },
            },
            orderBy: { date: "desc" },
            select: {
              id: true,
              description: true,
              amount: true,
              date: true,
              category: true,
              accountEntry: { select: { account: true } },
              lineItems: {
                select: { id: true, description: true, category: true, amount: true },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              },
            },
          });
          return cashflows.map((c) => ({
            ...c,
            amount: Number(c.amount),
            lineItems: c.lineItems.map((li) => ({ ...li, amount: Number(li.amount) })),
          }));
        }

        const linkedExpenses = await ctx.prisma.budgetItemExpense.findMany({
          where: { budgetItemId: input.budgetItemId },
          select: { cashflowEntryId: true },
        });
        const linkedIds = linkedExpenses.map((e) => e.cashflowEntryId);
        const cashflows = await ctx.prisma.cashflowEntry.findMany({
          where: {
            isActive: true,
            id: { notIn: linkedIds },
          },
          orderBy: { date: "desc" },
          select: {
            id: true,
            description: true,
            amount: true,
            date: true,
            category: true,
            accountEntry: { select: { account: true } },
            lineItems: {
              select: { id: true, description: true, category: true, amount: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
          },
        });

        return cashflows.map((c) => ({
          ...c,
          amount: Number(c.amount),
          lineItems: c.lineItems.map((li) => ({ ...li, amount: Number(li.amount) })),
        }));
      }),
  }),

  // Cashflow entries (verified official transactions)
  cashflowEntries: router({
    list: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).optional().default(50),
          cursor: z.string().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 50;
        const cursor = input?.cursor;
        const entries = await ctx.prisma.cashflowEntry.findMany({
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ date: "desc" }, { id: "desc" }],
          include: {
            receipts: {
              select: { id: true },
            },
            receiptSubmissions: {
              select: { id: true },
            },
            accountEntry: {
              select: { id: true, description: true, account: true },
            },
            lineItems: {
              select: {
                id: true,
                description: true,
                category: true,
                amount: true,
              },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
          },
        });
        const nextCursor = entries.length > limit ? entries[limit - 1].id : null;
        const items = entries.slice(0, limit);
        return {
          items: items.map((entry) => ({
            id: entry.id,
            date: entry.date,
            description: entry.description,
            category: entry.category,
            amount: Number(entry.amount),
            currency: entry.currency,
            notes: entry.notes,
            isActive: entry.isActive,
            archivedAt: entry.archivedAt,
            receiptsCount: entry.receipts.length + entry.receiptSubmissions.length,
            accountEntryId: entry.accountEntryId,
            accountEntry: entry.accountEntry,
            lineItems: entry.lineItems.map((item) => ({
              id: item.id,
              description: item.description,
              category: item.category,
              amount: Number(item.amount),
            })),
          })),
          nextCursor,
        };
      }),
    // Server-side paginated list with filters (only fetches one page from DB)
    listPage: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
          search: z.string().optional(),
          statusFilter: z.enum(["all", "no_receipt", "verified", "manual"]).optional().default("all"),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          dateSingle: z.string().optional(),
          dateSort: z.enum(["desc", "asc"]).default("desc"),
        })
      )
      .query(async ({ ctx, input }) => {
        const whereParts: Parameters<typeof ctx.prisma.cashflowEntry.findMany>[0]["where"] & { AND: unknown[] } = {
          isActive: true,
          AND: [],
        };

        if (input.search?.trim()) {
          const q = input.search.trim();
          (whereParts.AND as object[]).push({
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              ...(q && !Number.isNaN(Number(q)) ? [{ amount: Number(q) }] : []),
            ],
          });
        }

        if (input.statusFilter !== "all") {
          if (input.statusFilter === "no_receipt") {
            (whereParts.AND as object[]).push(
              { receipts: { none: {} } },
              { receiptSubmissions: { none: {} } },
            );
          } else if (input.statusFilter === "verified") {
            (whereParts.AND as object[]).push(
              { accountEntryId: { not: null } },
              {
                OR: [
                  { receipts: { some: {} } },
                  { receiptSubmissions: { some: {} } },
                ],
              },
            );
          } else if (input.statusFilter === "manual") {
            (whereParts.AND as object[]).push(
              { accountEntryId: null },
              {
                OR: [
                  { receipts: { some: {} } },
                  { receiptSubmissions: { some: {} } },
                ],
              },
            );
          }
        }

        if (input.dateSingle) {
          const start = new Date(input.dateSingle + "T00:00:00.000Z");
          const end = new Date(start.getTime() + 86400000);
          (whereParts.AND as object[]).push({
            date: { gte: start, lt: end },
          });
        } else if (input.dateFrom && input.dateTo) {
          (whereParts.AND as object[]).push({
            date: {
              gte: new Date(input.dateFrom + "T00:00:00.000Z"),
              lte: new Date(input.dateTo + "T23:59:59.999Z"),
            },
          });
        }

        const orderBy = [
          { date: input.dateSort } as const,
          { id: input.dateSort } as const,
        ];

        const entries = await ctx.prisma.cashflowEntry.findMany({
          where: whereParts.AND.length ? whereParts : { isActive: true },
          orderBy,
          skip: input.offset,
          take: input.limit + 1,
          include: {
            receipts: { select: { id: true } },
            receiptSubmissions: { select: { id: true } },
            accountEntry: {
              select: { id: true, description: true, account: true },
            },
            lineItems: {
              select: {
                id: true,
                description: true,
                category: true,
                amount: true,
              },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
          },
        });

        const hasMore = entries.length > input.limit;
        const items = entries.slice(0, input.limit);

        return {
          items: items.map((entry) => ({
            id: entry.id,
            date: entry.date,
            description: entry.description,
            category: entry.category,
            amount: Number(entry.amount),
            currency: entry.currency,
            notes: entry.notes,
            isActive: entry.isActive,
            archivedAt: entry.archivedAt,
            receiptsCount: entry.receipts.length + entry.receiptSubmissions.length,
            accountEntryId: entry.accountEntryId,
            accountEntry: entry.accountEntry,
            lineItems: entry.lineItems.map((item) => ({
              id: item.id,
              description: item.description,
              category: item.category,
              amount: Number(item.amount),
            })),
          })),
          hasMore,
        };
      }),
    // Get line items for a specific cashflow entry
    getLineItems: whitelistedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const items = await ctx.prisma.cashflowLineItem.findMany({
          where: { cashflowEntryId: input.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            description: true,
            category: true,
            amount: true,
            notes: true,
          },
        });
        return items.map((item) => ({
          id: item.id,
          description: item.description,
          category: item.category,
          amount: Number(item.amount),
          notes: item.notes,
        }));
      }),
    // Replace line items for an entry (validates that the sum equals entry.amount)
    setLineItems: cashflowEditorProcedure
      .input(
        z.object({
          cashflowEntryId: z.string(),
          items: z
            .array(
              z.object({
                id: z.string().optional(),
                description: z.string().min(1),
                category: z.string().min(1),
                amount: z.coerce.number(),
                notes: z.string().optional(),
              }),
            )
            .max(100),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const entry = await ctx.prisma.cashflowEntry.findUnique({
          where: { id: input.cashflowEntryId },
          select: { id: true, amount: true, description: true },
        });
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cashflow entry not found" });
        }

        const targetAmount = Number(entry.amount);
        const total = input.items.reduce((sum, item) => sum + item.amount, 0);

        // Use a small epsilon to account for floating point rounding on the client side.
        const EPSILON = 0.01;
        if (Math.abs(total - targetAmount) > EPSILON) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Line items do not add up. Expected total ${targetAmount.toFixed(
              2,
            )}, got ${total.toFixed(2)}.`,
          });
        }

        await ctx.prisma.$transaction(async (tx) => {
          // Delete existing items for this entry
          await tx.cashflowLineItem.deleteMany({
            where: { cashflowEntryId: input.cashflowEntryId },
          });

          if (input.items.length === 0) return;

          await tx.cashflowLineItem.createMany({
            data: input.items.map((item) => ({
              ...(item.id ? { id: item.id } : {}),
              cashflowEntryId: input.cashflowEntryId,
              description: item.description,
              category: item.category,
              amount: item.amount,
              notes: item.notes ?? null,
            })),
          });
        });

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "updated",
          "cashflow_line_item",
          `updated line items for transaction "${entry.description}"`,
          entry.id,
          { lineItemCount: input.items.length, total },
          ctx.ws,
        );

        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.CASHFLOW_UPDATED,
          action: "updated",
          entityId: entry.id,
        });

        return { success: true };
      }),
    // Get receipts for a specific cashflow entry
    getReceipts: whitelistedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const entry = await ctx.prisma.cashflowEntry.findUnique({
          where: { id: input.id },
          include: {
            receiptSubmissions: {
              select: {
                id: true,
                submitterName: true,
                purpose: true,
                imageData: true,
                imageType: true,
                notes: true,
                boundAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
            },
          },
        });
        return entry?.receiptSubmissions ?? [];
      }),
    create: cashflowEditorProcedure
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
        const entry = await ctx.prisma.cashflowEntry.create({
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

        const action = input.accountEntryId ? "verified" : "created";
        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          action,
          "cashflow_entry",
          `${action} transaction "${input.description}" for ${input.amount >= 0 ? "+" : ""}${input.amount}`,
          entry.id,
          { amount: input.amount, category: input.category },
          ctx.ws
        );

        // Emit cashflow and potentially account entry updates
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.CASHFLOW_UPDATED,
          action: "created",
          entityId: entry.id,
        });
        if (input.accountEntryId) {
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.ACCOUNT_ENTRY_UPDATED,
            action: "updated",
            entityId: input.accountEntryId,
          });
        }
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.STATS_UPDATED,
          action: "updated",
        });

        return entry;
      }),
    update: cashflowEditorProcedure
      .input(
        z.object({
          id: z.string().min(1),
          description: z.string().min(2),
          category: z.string().min(2),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const entry = await ctx.prisma.cashflowEntry.findUnique({
          where: { id: input.id },
          select: { id: true, accountEntryId: true },
        });
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cashflow entry not found." });
        }

        await ctx.prisma.cashflowEntry.update({
          where: { id: input.id },
          data: {
            description: input.description,
            category: input.category,
          },
        });

        // Keep linked account entry (RBA) in sync: update its description to match
        if (entry.accountEntryId) {
          await ctx.prisma.accountEntry.updateMany({
            where: { id: entry.accountEntryId },
            data: { description: input.description },
          });
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.ACCOUNT_ENTRY_UPDATED,
            action: "updated",
            entityId: entry.accountEntryId,
          });
        }

        await logActivity(
          ctx.prisma,
          ctx.session.user.id,
          "updated",
          "cashflow_entry",
          `updated transaction to "${input.description}"`,
          input.id,
          { description: input.description, category: input.category },
          ctx.ws
        );

        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.CASHFLOW_UPDATED,
          action: "updated",
          entityId: input.id,
        });
        ctx.ws?.emitToUser(ctx.session.user.id, {
          event: WS_EVENTS.STATS_UPDATED,
          action: "updated",
        });

        return { updated: true };
      }),
    archive: cashflowEditorProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const entry = await ctx.prisma.cashflowEntry.findUnique({
          where: { id: input.id },
        });

        const result = await ctx.prisma.cashflowEntry.updateMany({
          where: {
            id: input.id,
          },
          data: {
            isActive: false,
            archivedAt: new Date(),
          },
        });

        if (result.count > 0) {
          await logActivity(
            ctx.prisma,
            ctx.session.user.id,
            "archived",
            "cashflow_entry",
            `archived transaction "${entry?.description}"`,
            input.id,
            undefined,
            ctx.ws
          );

          // Emit cashflow update
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.CASHFLOW_UPDATED,
            action: "archived",
            entityId: input.id,
          });
          ctx.ws?.emitToUser(ctx.session.user.id, {
            event: WS_EVENTS.STATS_UPDATED,
            action: "updated",
          });
        }

        return { updated: result.count };
      }),
  }),

  // PDF report: entries table + receipts in order (for client-side PDF generation)
  report: router({
    getReportData: whitelistedProcedure
      .input(
        z.object({
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          dateSort: z.enum(["desc", "asc"]).default("desc"),
        })
      )
      .query(async ({ ctx, input }) => {
        const where =
          input.dateFrom && input.dateTo
            ? {
                isActive: true,
                date: {
                  gte: new Date(input.dateFrom + "T00:00:00.000Z"),
                  lte: new Date(input.dateTo + "T23:59:59.999Z"),
                },
              }
            : { isActive: true };
        const orderBy = [
          { date: input.dateSort } as const,
          { id: input.dateSort } as const,
        ];
        const entries = await ctx.prisma.cashflowEntry.findMany({
          where,
          orderBy,
          include: {
            receipts: { select: { id: true } },
            receiptSubmissions: {
              select: {
                id: true,
                submitterName: true,
                purpose: true,
                imageType: true,
                createdAt: true,
              },
              orderBy: { createdAt: "asc" },
            },
            accountEntry: {
              select: { id: true, description: true, account: true },
            },
            lineItems: {
              select: { description: true, category: true, amount: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
          },
        });

        // Starting/ending cash flow only when date range is set
        let startingCashFlow: number | null = null;
        let endingCashFlow: number | null = null;
        if (input.dateFrom && input.dateTo) {
          const startDate = new Date(input.dateFrom + "T00:00:00.000Z");
          const startingAgg = await ctx.prisma.cashflowEntry.aggregate({
            where: { isActive: true, date: { lt: startDate } },
            _sum: { amount: true },
          });
          startingCashFlow = Number(startingAgg._sum.amount ?? 0);
          const netInPeriod = entries.reduce((sum, e) => sum + Number(e.amount), 0);
          endingCashFlow = startingCashFlow + netInPeriod;
        }

        const entryRows = entries.map((entry) => ({
          id: entry.id,
          date: entry.date,
          description: entry.description,
          category: entry.category,
          amount: Number(entry.amount),
          currency: entry.currency,
          receiptsCount: entry.receipts.length + entry.receiptSubmissions.length,
          accountEntry: entry.accountEntry,
          lineItems: entry.lineItems.map((li) => ({
            description: li.description,
            category: li.category,
            amount: Number(li.amount),
          })),
        }));
        type ReceiptRow = {
          entryId: string;
          entryDate: Date;
          entryDescription: string;
          amount: number;
          receipt: {
            id: string;
            imageData: string | null;
            imageType: string | null;
            submitterName: string;
            purpose: string;
          };
        };
        const receiptsInOrder: ReceiptRow[] = [];
        for (const entry of entries) {
          for (const sub of entry.receiptSubmissions) {
            receiptsInOrder.push({
              entryId: entry.id,
              entryDate: entry.date,
              entryDescription: entry.description,
              amount: Number(entry.amount),
              receipt: {
                id: sub.id,
                imageData: null,
                imageType: sub.imageType,
                submitterName: sub.submitterName,
                purpose: sub.purpose,
              },
            });
          }
        }
        return {
          entries: entryRows,
          receiptsInOrder,
          startingCashFlow,
          endingCashFlow,
        };
      }),

    /** Fetch receipt images by IDs in batches (max 5 per request to stay under 5MB). Used after getReportData/getProjectReportData. */
    getReportReceiptImages: whitelistedProcedure
      .input(
        z.object({
          receiptIds: z.array(z.string()).min(1).max(5),
        })
      )
      .query(async ({ ctx, input }) => {
        const submissions = await ctx.prisma.receiptSubmission.findMany({
          where: { id: { in: input.receiptIds } },
          select: { id: true, imageData: true, imageType: true },
        });
        return submissions.map((s) => ({
          id: s.id,
          imageData: s.imageData,
          imageType: s.imageType,
        }));
      }),

    // Project report: project info, budget plan (expenses + income), expenditures, collected income, receipts in order
    getProjectReportData: whitelistedProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ ctx, input }) => {
        const project = await ctx.prisma.budgetProject.findFirst({
          where: { id: input.projectId, isActive: true },
          include: {
            items: {
              where: { isActive: true },
              orderBy: { createdAt: "asc" },
              include: {
                expenses: {
                  orderBy: { createdAt: "asc" },
                  include: {
                    cashflowEntry: {
                      include: {
                        receiptSubmissions: {
                          select: {
                            id: true,
                            submitterName: true,
                            purpose: true,
                            imageType: true,
                            createdAt: true,
                          },
                          orderBy: { createdAt: "asc" },
                        },
                        lineItems: {
                          select: { description: true, category: true, amount: true },
                          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                        },
                      },
                    },
                  },
                },
                incomes: {
                  orderBy: { createdAt: "asc" },
                  include: {
                    cashflowEntry: {
                      include: {
                        receiptSubmissions: {
                          select: {
                            id: true,
                            submitterName: true,
                            purpose: true,
                            imageType: true,
                            createdAt: true,
                          },
                          orderBy: { createdAt: "asc" },
                        },
                        lineItems: {
                          select: { description: true, category: true, amount: true },
                          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        if (!project) return null;

        const totalBudget = project.items
          .filter((i) => i.type === "expense")
          .reduce((sum, item) => sum + Number(item.estimatedAmount), 0);
        const totalIncomeBudget = project.items
          .filter((i) => i.type === "income")
          .reduce((sum, item) => sum + Number(item.estimatedAmount), 0);
        const totalActual = project.items.reduce(
          (sum, item) =>
            sum +
            item.expenses.reduce(
              (expSum, exp) => expSum + Math.abs(Number(exp.cashflowEntry.amount)),
              0
            ),
          0
        );
        const totalActualIncome = project.items.reduce(
          (sum, item) =>
            sum +
            item.incomes.reduce(
              (incSum, inc) => incSum + Number(inc.cashflowEntry.amount),
              0
            ),
          0
        );

        const budgetPlanRows = project.items.map((item) => ({
          itemName: item.name,
          description: item.description ?? "",
          type: item.type as "expense" | "income",
          estimatedAmount: Number(item.estimatedAmount),
          notes: item.notes ?? "",
        }));

        type LineItemRow = { description: string; category: string; amount: number };
        type ExpenditureRow = {
          date: Date;
          budgetItemName: string;
          description: string;
          amount: number;
          cashflowEntryId: string;
          lineItems?: LineItemRow[];
        };
        type IncomeRow = {
          date: Date;
          budgetItemName: string;
          description: string;
          amount: number;
          cashflowEntryId: string;
          lineItems?: LineItemRow[];
        };
        type ReceiptRow = {
          entryId: string;
          entryDate: Date;
          entryDescription: string;
          amount: number;
          receipt: {
            id: string;
            imageData: string | null;
            imageType: string | null;
            submitterName: string;
            purpose: string;
          };
        };

        const expenseEntries: { date: Date; budgetItemName: string; entry: (typeof project.items)[0]["expenses"][0]["cashflowEntry"] }[] = [];
        for (const item of project.items) {
          for (const exp of item.expenses) {
            expenseEntries.push({
              date: exp.cashflowEntry.date,
              budgetItemName: item.name,
              entry: exp.cashflowEntry,
            });
          }
        }
        expenseEntries.sort(
          (a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime() ||
            a.budgetItemName.localeCompare(b.budgetItemName)
        );

        const expenditureRows: ExpenditureRow[] = expenseEntries.map(({ date, budgetItemName, entry }) => ({
          date,
          budgetItemName,
          description: entry.description,
          amount: Math.abs(Number(entry.amount)),
          cashflowEntryId: entry.id,
          lineItems:
            entry.lineItems?.map((li) => ({
              description: li.description,
              category: li.category,
              amount: Math.abs(Number(li.amount)),
            })) ?? [],
        }));

        const incomeEntries: { date: Date; budgetItemName: string; entry: (typeof project.items)[0]["incomes"][0]["cashflowEntry"] }[] = [];
        for (const item of project.items) {
          for (const inc of item.incomes) {
            incomeEntries.push({
              date: inc.cashflowEntry.date,
              budgetItemName: item.name,
              entry: inc.cashflowEntry,
            });
          }
        }
        incomeEntries.sort(
          (a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime() ||
            a.budgetItemName.localeCompare(b.budgetItemName)
        );

        const incomeRows: IncomeRow[] = incomeEntries.map(({ date, budgetItemName, entry }) => ({
          date,
          budgetItemName,
          description: entry.description,
          amount: Number(entry.amount),
          cashflowEntryId: entry.id,
          lineItems:
            entry.lineItems?.map((li) => ({
              description: li.description,
              category: li.category,
              amount: Number(li.amount),
            })) ?? [],
        }));

        const receiptsInOrder: ReceiptRow[] = [];
        for (const { entry } of expenseEntries) {
          for (const sub of entry.receiptSubmissions) {
            receiptsInOrder.push({
              entryId: entry.id,
              entryDate: entry.date,
              entryDescription: entry.description,
              amount: Math.abs(Number(entry.amount)),
              receipt: {
                id: sub.id,
                imageData: null,
                imageType: sub.imageType,
                submitterName: sub.submitterName,
                purpose: sub.purpose,
              },
            });
          }
        }
        for (const { entry } of incomeEntries) {
          for (const sub of entry.receiptSubmissions) {
            receiptsInOrder.push({
              entryId: entry.id,
              entryDate: entry.date,
              entryDescription: entry.description,
              amount: Number(entry.amount),
              receipt: {
                id: sub.id,
                imageData: null,
                imageType: sub.imageType,
                submitterName: sub.submitterName,
                purpose: sub.purpose,
              },
            });
          }
        }
        receiptsInOrder.sort(
          (a, b) =>
            new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime() ||
            a.entryDescription.localeCompare(b.entryDescription)
        );

        return {
          project: {
            id: project.id,
            name: project.name,
            description: project.description ?? "",
            category: project.category ?? "",
            eventDate: project.eventDate,
            status: project.status,
          },
          totalBudget,
          totalIncomeBudget,
          totalActual,
          totalActualIncome,
          budgetPlanRows,
          expenditureRows,
          incomeRows,
          receiptsInOrder,
        };
      }),
  }),
});
export type AppRouter = typeof appRouter;
