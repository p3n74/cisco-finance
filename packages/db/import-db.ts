/**
 * Database import script: loads a Prisma JSON export into PostgreSQL.
 *
 * Run from repo root: bun run packages/db/import-db.ts [path/to/export.json]
 * Or: cd packages/db && bun run import-db [path/to/export.json]
 *
 * Requires DATABASE_URL pointing to the target database (e.g. fin_db).
 * For localhost:5433: DATABASE_URL=postgresql://audit:YOUR_PASSWORD@localhost:5433/fin_db
 *
 * Loads .env from apps/server/.env - set DATABASE_URL there or in your shell.
 *
 * Options:
 *   --truncate   Truncate all tables before import (clean slate). Default: merge (skip duplicates).
 */

import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../.env") });
config({ path: path.resolve(__dirname, "../../apps/server/.env") });

const { prisma } = await import("./src");

// Insert order respects foreign keys (parents before children)
const TABLE_ORDER = [
  "user",
  "authorizedUser",
  "accountEntry",
  "cashflowEntry",
  "cashflowLineItem",
  "receipt",
  "session",
  "account",
  "verification",
  "activityLog",
  "budgetProject",
  "budgetItem",
  "budgetItemExpense",
  "budgetItemIncome",
  "receiptSubmission",
  "chatMessage",
] as const;

type TableKey = (typeof TABLE_ORDER)[number];

const MODEL_MAP: Record<TableKey, keyof typeof prisma> = {
  user: "user",
  authorizedUser: "authorizedUser",
  accountEntry: "accountEntry",
  cashflowEntry: "cashflowEntry",
  cashflowLineItem: "cashflowLineItem",
  receipt: "receipt",
  session: "session",
  account: "account",
  verification: "verification",
  activityLog: "activityLog",
  budgetProject: "budgetProject",
  budgetItem: "budgetItem",
  budgetItemExpense: "budgetItemExpense",
  budgetItemIncome: "budgetItemIncome",
  receiptSubmission: "receiptSubmission",
  chatMessage: "chatMessage",
};

async function importDatabase(jsonPath: string, truncate: boolean) {
  console.log(`Reading ${jsonPath}...`);
  const raw = await readFile(jsonPath, "utf-8");
  const data = JSON.parse(raw) as { tables: Record<string, unknown[]> };

  if (!data.tables || typeof data.tables !== "object") {
    throw new Error("Invalid export format: expected { tables: { ... } }");
  }

  if (truncate) {
    console.log("Truncating tables (in reverse FK order)...");
    // Truncate in reverse order to satisfy FK constraints
    for (let i = TABLE_ORDER.length - 1; i >= 0; i--) {
      const key = TABLE_ORDER[i]!;
      const model = MODEL_MAP[key];
      if (!model || !(model in prisma)) continue;
      const table = prisma[model] as { deleteMany: () => Promise<{ count: number }> };
      const { count } = await table.deleteMany();
      if (count > 0) console.log(`  Truncated ${key}: ${count} rows`);
    }
  }

  let total = 0;
  for (const key of TABLE_ORDER) {
    const rows = data.tables[key] as Record<string, any>[] | undefined;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      if (rows?.length === 0) console.log(`  ${key}: 0 rows (skipped)`);
      continue;
    }

    const model = MODEL_MAP[key];
    if (!model || !(model in prisma)) {
      console.warn(`  ${key}: no Prisma model, skipping`);
      continue;
    }

    let rowsToInsert: Record<string, any>[] = rows;

    // Filter out rows that would violate obvious foreign key constraints when merging into
    // a non-empty database. This is a defensive guard mainly for session -> user.
    if (key === "session") {
      const userRows = (data.tables.user as Record<string, any>[]) ?? [];
      const validUserIds = new Set(userRows.map((u) => u.id));
      rowsToInsert = rows.filter((r) => validUserIds.has(r.userId));
    }

    const table = prisma[model] as {
      createMany: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
    };

    const result = await table.createMany({
      data: rowsToInsert,
      skipDuplicates: !truncate,
    });

    console.log(`  ${key}: ${result.count} rows imported`);
    total += result.count;
  }

  console.log(`\nImport complete. Total rows: ${total}`);
}

const args = process.argv.slice(2);
const truncate = args.includes("--truncate");
const jsonArg = args.find((a) => !a.startsWith("--"));
const jsonPath = jsonArg
  ? path.resolve(process.cwd(), jsonArg)
  : path.resolve(__dirname, "../../prismadb-export-2026-02-19T12-11-21.json");

importDatabase(jsonPath, truncate)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
