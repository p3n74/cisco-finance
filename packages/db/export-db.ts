/**
 * Database export script: dumps all Prisma-managed tables to a JSON file.
 *
 * Run from repo root: bun run packages/db/export-db.ts
 * Or: cd packages/db && bun run export-db
 *
 * Requires DATABASE_URL. Loads .env from apps/server/.env so the same
 * credentials as the webapp are used. Output is written to packages/db/exports/
 * with a timestamped filename.
 */

import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../.env") });
config({ path: path.resolve(__dirname, "../../apps/server/.env") });

const { prisma } = await import("./src");

const EXPORTS_DIR = path.resolve(__dirname, "exports");

async function exportDatabase() {
  console.log("Exporting database...");

  const [
    user,
    authorizedUser,
    accountEntry,
    cashflowEntry,
    cashflowLineItem,
    receipt,
    session,
    account,
    verification,
    activityLog,
    budgetProject,
    budgetItem,
    budgetItemExpense,
    budgetItemIncome,
    chatMessage,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.authorizedUser.findMany(),
    prisma.accountEntry.findMany(),
    prisma.cashflowEntry.findMany(),
    prisma.cashflowLineItem.findMany(),
    prisma.receipt.findMany(),
    prisma.session.findMany(),
    prisma.account.findMany(),
    prisma.verification.findMany(),
    prisma.activityLog.findMany(),
    prisma.budgetProject.findMany(),
    prisma.budgetItem.findMany(),
    prisma.budgetItemExpense.findMany(),
    prisma.budgetItemIncome.findMany(),
    prisma.chatMessage.findMany(),
  ]);

  // ReceiptSubmission has large base64 image fields - fetch in batches to avoid Prisma 5MB response limit
  const receiptSubmission: Awaited<ReturnType<typeof prisma.receiptSubmission.findMany>> = [];
  const BATCH_SIZE = 3;
  let cursor: string | undefined;
  do {
    const batch = await prisma.receiptSubmission.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    receiptSubmission.push(...batch);
    cursor = batch.length === BATCH_SIZE ? batch[batch.length - 1]!.id : undefined;
  } while (cursor);

  const exportData = {
    exportedAt: new Date().toISOString(),
    tables: {
      user,
      authorizedUser,
      accountEntry,
      cashflowEntry,
      cashflowLineItem,
      receipt,
      session,
      account,
      verification,
      activityLog,
      budgetProject,
      budgetItem,
      budgetItemExpense,
      budgetItemIncome,
      receiptSubmission,
      chatMessage,
    },
  };

  await mkdir(EXPORTS_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `prismadb-export-${timestamp}.json`;
  const filepath = path.join(EXPORTS_DIR, filename);

  await writeFile(filepath, JSON.stringify(exportData, null, 2), "utf-8");

  console.log(`Export complete: ${filepath}`);
  return filepath;
}

exportDatabase()
  .then((filepath) => {
    console.log(`Download/save location: ${filepath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
