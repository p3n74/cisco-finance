import { z } from "zod";

import { protectedProcedure, publicProcedure, router } from "../index";
import { WS_EVENTS, type WsEmitter, type Context } from "../context";
import { teamRouter } from "./team";
import { sendEmail } from "../services/email";
import { env } from "@cisco-finance/env/server";

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

  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),

  // Activity log
  activityLog: router({
    list: protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).optional().default(50),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const logs = await ctx.prisma.activityLog.findMany({
          take: input?.limit ?? 50,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: { id: true, name: true, image: true },
            },
          },
        });
        return logs.map((log) => ({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          description: log.description,
          metadata: log.metadata ? JSON.parse(log.metadata) : null,
          createdAt: log.createdAt,
          user: log.user,
        }));
      }),
  }),

  // Dashboard overview stats
  overview: router({
    stats: protectedProcedure.query(async ({ ctx }) => {
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
          imageData: z.string().min(1, "Please upload a receipt image"),
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
    // Admin: list all submissions
    list: protectedProcedure.query(async ({ ctx }) => {
      const submissions = await ctx.prisma.receiptSubmission.findMany({
        orderBy: { createdAt: "desc" },
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
      return submissions.map((s) => ({
        ...s,
        isBound: !!s.cashflowEntryId,
        cashflowEntry: s.cashflowEntry
          ? {
              ...s.cashflowEntry,
              amount: Number(s.cashflowEntry.amount),
            }
          : null,
      }));
    }),
    // Admin: get single submission with image
    getById: protectedProcedure
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
    bind: protectedProcedure
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
    unbind: protectedProcedure
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
    countUnbound: protectedProcedure.query(async ({ ctx }) => {
      const count = await ctx.prisma.receiptSubmission.count({
        where: { cashflowEntryId: null },
      });
      return { count };
    }),
    // List unbound submissions (for binding dialog)
    listUnbound: protectedProcedure.query(async ({ ctx }) => {
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
    submitAndBind: protectedProcedure
      .input(
        z.object({
          submitterName: z.string().min(2, "Name must be at least 2 characters"),
          purpose: z.string().min(5, "Please describe what this receipt is for"),
          imageData: z.string().min(1, "Please upload a receipt image"),
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
    endorse: protectedProcedure
      .input(z.object({ 
        id: z.string(),
        message: z.string().optional()
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.userRole !== "AUDITOR") {
          throw new Error("Only the Auditor can endorse receipts for reimbursement.");
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
    // Mark receipt as reimbursed (Treasurer only)
    markAsReimbursed: protectedProcedure
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
    list: protectedProcedure.query(async ({ ctx }) => {
      const entries = await ctx.prisma.accountEntry.findMany({
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
    archive: protectedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const entry = await ctx.prisma.accountEntry.findUnique({
          where: { id: input.id },
        });

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
    // List all projects for user
    list: protectedProcedure.query(async ({ ctx }) => {
      const projects = await ctx.prisma.budgetProject.findMany({
        where: {
          isActive: true,
        },
        orderBy: [
          { status: "asc" }, // planned first, then completed
          { eventDate: "asc" },
          { createdAt: "desc" },
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
                    },
                  },
                },
              },
            },
          },
        },
      });

      return projects.map((project) => {
        const totalBudget = project.items.reduce(
          (sum, item) => sum + Number(item.estimatedAmount),
          0
        );
        const totalActual = project.items.reduce(
          (sum, item) =>
            sum +
            item.expenses.reduce(
              (expSum, exp) => expSum + Math.abs(Number(exp.cashflowEntry.amount)),
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
          totalActual,
          itemCount: project.items.length,
          items: project.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            estimatedAmount: Number(item.estimatedAmount),
            notes: item.notes,
            isActive: item.isActive,
            createdAt: item.createdAt,
            actualAmount: item.expenses.reduce(
              (sum, exp) => sum + Math.abs(Number(exp.cashflowEntry.amount)),
              0
            ),
            expenseCount: item.expenses.length,
            expenses: item.expenses.map((exp) => ({
              id: exp.id,
              cashflowEntryId: exp.cashflowEntryId,
              cashflowEntry: {
                ...exp.cashflowEntry,
                amount: Number(exp.cashflowEntry.amount),
              },
              createdAt: exp.createdAt,
            })),
          })),
        };
      });
    }),

    // Get single project by ID
    getById: protectedProcedure
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
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!project) return null;

        const totalBudget = project.items.reduce(
          (sum, item) => sum + Number(item.estimatedAmount),
          0
        );
        const totalActual = project.items.reduce(
          (sum, item) =>
            sum +
            item.expenses.reduce(
              (expSum, exp) => expSum + Math.abs(Number(exp.cashflowEntry.amount)),
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
          totalActual,
          items: project.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            estimatedAmount: Number(item.estimatedAmount),
            notes: item.notes,
            isActive: item.isActive,
            createdAt: item.createdAt,
            actualAmount: item.expenses.reduce(
              (sum, exp) => sum + Math.abs(Number(exp.cashflowEntry.amount)),
              0
            ),
            expenses: item.expenses.map((exp) => ({
              id: exp.id,
              cashflowEntryId: exp.cashflowEntryId,
              cashflowEntry: {
                ...exp.cashflowEntry,
                amount: Number(exp.cashflowEntry.amount),
              },
              createdAt: exp.createdAt,
            })),
          })),
        };
      }),

    // Create new project
    create: protectedProcedure
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
    update: protectedProcedure
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
    archive: protectedProcedure
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
    overview: protectedProcedure.query(async ({ ctx }) => {
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
                  cashflowEntry: {
                    select: { amount: true },
                  },
                },
              },
            },
          },
        },
      });

      const plannedProjects = projects.filter((p) => p.status === "planned");
      const completedProjects = projects.filter((p) => p.status === "completed");

      const totalBudget = projects.reduce(
        (sum, p) =>
          sum + p.items.reduce((iSum, item) => iSum + Number(item.estimatedAmount), 0),
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
        totalActual,
        upcomingEvents,
      };
    }),
  }),

  // Budget Items
  budgetItems: router({
    // Create new item in a project
    create: protectedProcedure
      .input(
        z.object({
          budgetProjectId: z.string(),
          name: z.string().min(2, "Name must be at least 2 characters"),
          description: z.string().optional(),
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
    update: protectedProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(2).optional(),
          description: z.string().optional(),
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

    // Delete item (only if no linked expenses)
    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // Verify item exists
        const item = await ctx.prisma.budgetItem.findFirst({
          where: { id: input.id },
          include: {
            budgetProject: { select: { name: true } },
            expenses: { select: { id: true } },
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
    linkExpense: protectedProcedure
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
    unlinkExpense: protectedProcedure
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

    // Get unlinked cashflow entries (for linking dropdown)
    getUnlinkedCashflows: protectedProcedure
      .input(z.object({ budgetItemId: z.string() }))
      .query(async ({ ctx, input }) => {
        // Get already linked cashflow IDs for this budget item
        const linkedExpenses = await ctx.prisma.budgetItemExpense.findMany({
          where: { budgetItemId: input.budgetItemId },
          select: { cashflowEntryId: true },
        });
        const linkedIds = linkedExpenses.map((e) => e.cashflowEntryId);

        // Get all active cashflow entries not already linked to this item
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
            accountEntry: {
              select: { account: true },
            },
          },
        });

        return cashflows.map((c) => ({
          ...c,
          amount: Number(c.amount),
        }));
      }),
  }),

  // Cashflow entries (verified official transactions)
  cashflowEntries: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const entries = await ctx.prisma.cashflowEntry.findMany({
        orderBy: {
          date: "desc",
        },
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
        receiptsCount: entry.receipts.length + entry.receiptSubmissions.length,
        accountEntryId: entry.accountEntryId,
        accountEntry: entry.accountEntry,
      }));
    }),
    // Get receipts for a specific cashflow entry
    getReceipts: protectedProcedure
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
    archive: protectedProcedure
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
});
export type AppRouter = typeof appRouter;
