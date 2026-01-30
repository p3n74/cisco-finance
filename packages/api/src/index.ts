import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/** Whitelist: only users in the authorized_user table can view finance data. Normal logged-in users cannot. */
export const whitelistedProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.userRole == null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to CISCO Finance. Only whitelisted users can view finances.",
    });
  }
  return next({ ctx });
});

/** Roles allowed to create/edit/archive budgets and items. Others can view only. */
const BUDGET_EDITOR_ROLES = ["VP_FINANCE", "TREASURER", "AUDITOR", "WAYS_AND_MEANS"] as const;

export const budgetEditorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.userRole || !(BUDGET_EDITOR_ROLES as readonly string[]).includes(ctx.userRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only VP Finance, Treasurer, Auditor, or Ways and Means can edit budgets. You can view only.",
    });
  }
  return next({ ctx });
});

/** Roles allowed to bind/unbind, endorse, and mark receipts reimbursed. Ways and Means and regular users can view only. */
const RECEIPT_EDITOR_ROLES = ["VP_FINANCE", "AUDITOR", "TREASURER"] as const;

export const receiptEditorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.userRole || !(RECEIPT_EDITOR_ROLES as readonly string[]).includes(ctx.userRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only VP Finance, Auditor, and Treasurer can manage receipts. You can view only.",
    });
  }
  return next({ ctx });
});

/** Roles allowed to verify transactions and manage cashflow on the dashboard. Treasurer, Ways and Means, and regular users can view only. */
const CASHFLOW_EDITOR_ROLES = ["VP_FINANCE", "AUDITOR"] as const;

export const cashflowEditorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.userRole || !(CASHFLOW_EDITOR_ROLES as readonly string[]).includes(ctx.userRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only VP Finance and Auditor can verify transactions and manage cashflow. You can view only.",
    });
  }
  return next({ ctx });
});

/** Roles allowed to create/edit/archive account entries (treasury ledger). Only Treasurer and VP Finance. */
const ACCOUNT_EDITOR_ROLES = ["VP_FINANCE", "TREASURER"] as const;

export const accountEditorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.userRole || !(ACCOUNT_EDITOR_ROLES as readonly string[]).includes(ctx.userRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only VP Finance and Treasurer can manage account entries. You can view only.",
    });
  }
  return next({ ctx });
});
