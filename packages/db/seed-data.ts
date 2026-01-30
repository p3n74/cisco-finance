/**
 * Seed script: procedurally generates AccountEntry, CashflowEntry, ReceiptSubmission,
 * BudgetProject, BudgetItem, and BudgetItemExpense with random data. Images are a small placeholder PNG.
 *
 * Run from repo root: bun run --cwd cisco-finance/packages/db seed-data
 * Or: cd cisco-finance/packages/db && bun run seed-data
 *
 * Requires DATABASE_URL. Loads .env from apps/server/.env before Prisma so the
 * same credentials as the webapp are used. Uses existing User if any; otherwise creates a seed user.
 */

import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load apps/server/.env FIRST so DATABASE_URL is in process.env before @cisco-finance/env (and Prisma) load.
config({ path: path.resolve(__dirname, "../../.env") });
config({ path: path.resolve(__dirname, "../../apps/server/.env") });

const { prisma } = await import("./src");

// 1x1 transparent PNG (smallest valid image placeholder)
const PLACEHOLDER_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PLACEHOLDER_IMAGE_TYPE = "image/png";

const ACCOUNTS = ["GCash", "GoTyme", "Cash", "BPI"] as const;
const CURRENCY = "PHP";

const ACCOUNT_DESCRIPTIONS = [
  "Office supplies",
  "Transportation fare",
  "Meal allowance",
  "Printing and photocopy",
  "Event registration",
  "Internet load",
  "Snacks for meeting",
  "Courier delivery",
  "Parking fee",
  "BPI withdrawal",
  "GCash transfer",
  "Donation",
  "Membership fee",
  "Workshop materials",
  "Lunch reimbursement",
];

const CASHFLOW_CATEGORIES = [
  "Supplies",
  "Transport",
  "Meals",
  "Events",
  "Utilities",
  "Communications",
  "Donations",
  "Membership",
  "Training",
  "Miscellaneous",
];

const RECEIPT_PURPOSES = [
  "Office supplies purchase",
  "Transportation reimbursement",
  "Meal allowance for event",
  "Printing and photocopy services",
  "Event registration fee",
  "Internet and load",
  "Snacks for committee meeting",
  "Courier and delivery",
  "Parking and toll",
  "Workshop materials",
  "Donation receipt",
  "Membership renewal",
  "Training materials",
];

const SUBMITTER_NAMES = [
  "Juan Dela Cruz",
  "Maria Santos",
  "Pedro Reyes",
  "Ana Garcia",
  "Carlos Lopez",
  "Sofia Mendoza",
  "Miguel Torres",
  "Elena Ramos",
  "Jose Fernandez",
  "Carmen Rivera",
];

const BUDGET_PROJECT_NAMES = [
  "Annual General Assembly",
  "Leadership Training",
  "Retreat 2025",
  "Christmas Party",
  "Orientation Week",
  "Sports Fest",
  "Cultural Night",
  "Outreach Program",
  "Equipment Purchase",
  "Office Renovation",
  "Conference Attendance",
  "Team Building",
];

const BUDGET_CATEGORIES = [
  "Events",
  "Training",
  "Operations",
  "Equipment",
  "Outreach",
  "Administrative",
  "Travel",
  "Supplies",
];

const BUDGET_ITEM_NAMES = [
  "Venue and rental",
  "Catering",
  "Materials and handouts",
  "Transportation",
  "Accommodation",
  "Speaker fees",
  "Prizes and giveaways",
  "Printing and signage",
  "AV and equipment",
  "Miscellaneous",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomAmount(min: number, max: number, allowNegative = false): number {
  const magnitude = min + Math.random() * (max - min);
  if (allowNegative && Math.random() < 0.4) return -magnitude;
  return magnitude;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

async function getOrCreateSeedUserId(): Promise<string> {
  const existing = await prisma.user.findFirst({ select: { id: true } });
  if (existing) return existing.id;

  const seedUser = await prisma.user.create({
    data: {
      id: `seed_${crypto.randomUUID()}`,
      name: "Seed User",
      email: "seed@cisco-finance.local",
      emailVerified: false,
    },
  });
  console.log("Created seed user:", seedUser.email);
  return seedUser.id;
}

async function seedAccountEntries(userId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = daysAgo(randomInt(0, 90));
    const amount = randomAmount(50, 15000, true);
    const entry = await prisma.accountEntry.create({
      data: {
        userId,
        date,
        description: pick(ACCOUNT_DESCRIPTIONS),
        account: pick(ACCOUNTS),
        amount,
        currency: CURRENCY,
        notes: Math.random() < 0.3 ? "Seed data" : null,
      },
    });
    ids.push(entry.id);
  }
  console.log(`Created ${count} account entries`);
  return ids;
}

async function seedCashflowEntries(
  userId: string,
  accountEntryIds: string[],
  count: number,
): Promise<string[]> {
  // Every cashflow entry must link to an account entry (only verified account txns go to cashflow).
  const linkCount = Math.min(count, accountEntryIds.length);
  if (linkCount === 0) {
    console.log("Skipped cashflow entries: no account entries to link");
    return [];
  }

  const accountEntries = await prisma.accountEntry.findMany({
    where: { id: { in: accountEntryIds } },
    select: { id: true, date: true, amount: true, description: true, account: true },
  });
  const byId = new Map(accountEntries.map((e) => [e.id, e]));
  const shuffled = [...accountEntryIds].sort(() => Math.random() - 0.5);

  const ids: string[] = [];
  for (let i = 0; i < linkCount; i++) {
    const accountId = shuffled[i];
    const account = byId.get(accountId);
    if (!account) continue;
    const amount = Number(account.amount);
    const entry = await prisma.cashflowEntry.create({
      data: {
        userId,
        date: account.date,
        description: account.description,
        category: pick(CASHFLOW_CATEGORIES),
        amount,
        currency: CURRENCY,
        notes: Math.random() < 0.2 ? "Seed verified" : null,
        accountEntryId: accountId,
      },
    });
    ids.push(entry.id);
  }
  console.log(`Created ${linkCount} cashflow entries (each linked to an account entry)`);
  return ids;
}

async function seedReceiptSubmissions(
  cashflowEntryIds: string[],
  count: number,
  seedUserId: string,
): Promise<void> {
  const boundCount = Math.min(Math.floor(count * 0.5), cashflowEntryIds.length);
  const usedCashflowIds = new Set<string>();

  for (let i = 0; i < count; i++) {
    const bindToCashflow =
      i < boundCount && cashflowEntryIds.length > 0
        ? pick(cashflowEntryIds.filter((id) => !usedCashflowIds.has(id)))
        : null;
    if (bindToCashflow) usedCashflowIds.add(bindToCashflow);
    const boundAt = bindToCashflow ? daysAgo(randomInt(1, 30)) : null;

    await prisma.receiptSubmission.create({
      data: {
        submitterName: pick(SUBMITTER_NAMES),
        purpose: pick(RECEIPT_PURPOSES),
        imageData: PLACEHOLDER_IMAGE_BASE64,
        imageType: PLACEHOLDER_IMAGE_TYPE,
        notes: Math.random() < 0.25 ? "Seed receipt" : null,
        needsReimbursement: Math.random() < 0.5,
        reimbursementMethod: Math.random() < 0.5 ? pick(["cash", "online"]) : null,
        accountType: Math.random() < 0.4 ? pick(["gcash", "bank"]) : null,
        accountNumber: Math.random() < 0.35 ? `09${randomInt(100000000, 999999999)}` : null,
        accountName: Math.random() < 0.35 ? pick(SUBMITTER_NAMES) : null,
        contactInfo: Math.random() < 0.2 ? `09${randomInt(100000000, 999999999)}` : null,
        contactType: Math.random() < 0.2 ? pick(["phone", "email"]) : null,
        cashflowEntryId: bindToCashflow ?? null,
        boundAt: boundAt ?? undefined,
        boundBy: boundAt ? seedUserId : undefined,
      },
    });
  }
  console.log(`Created ${count} receipt submissions (${boundCount} bound to cashflow)`);
}

async function seedBudgetProjects(userId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    let name = pick(BUDGET_PROJECT_NAMES);
    while (usedNames.has(name)) {
      name = pick(BUDGET_PROJECT_NAMES);
    }
    usedNames.add(name);

    const status = Math.random() < 0.4 ? "completed" : "planned";
    const eventDate = Math.random() < 0.8 ? daysAgo(randomInt(-30, 90)) : null;

    const project = await prisma.budgetProject.create({
      data: {
        userId,
        name,
        description: Math.random() < 0.6 ? `Seed budget for ${name}` : null,
        category: pick(BUDGET_CATEGORIES),
        eventDate: eventDate ?? undefined,
        status,
      },
    });
    ids.push(project.id);
  }
  console.log(`Created ${count} budget projects`);
  return ids;
}

async function seedBudgetItems(projectIds: string[]): Promise<string[]> {
  const itemIds: string[] = [];
  const itemsPerProject = randomInt(2, 5);

  for (const projectId of projectIds) {
    const itemCount = randomInt(2, itemsPerProject);
    for (let i = 0; i < itemCount; i++) {
      const item = await prisma.budgetItem.create({
        data: {
          budgetProjectId: projectId,
          name: pick(BUDGET_ITEM_NAMES),
          description: Math.random() < 0.4 ? "Seed budget line item" : null,
          estimatedAmount: randomAmount(500, 15000, false),
          notes: Math.random() < 0.3 ? "Estimated" : null,
        },
      });
      itemIds.push(item.id);
    }
  }
  const total = itemIds.length;
  console.log(`Created ${total} budget items across ${projectIds.length} projects`);
  return itemIds;
}

async function seedBudgetItemExpenses(
  budgetItemIds: string[],
  cashflowEntryIds: string[],
): Promise<void> {
  if (cashflowEntryIds.length === 0) return;

  const linkCount = Math.min(
    randomInt(5, 20),
    budgetItemIds.length * 2,
    cashflowEntryIds.length,
  );
  const usedPairs = new Set<string>();

  for (let i = 0; i < linkCount; i++) {
    const itemId = pick(budgetItemIds);
    const cashflowId = pick(cashflowEntryIds);
    const key = `${itemId}:${cashflowId}`;
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);

    try {
      await prisma.budgetItemExpense.create({
        data: {
          budgetItemId: itemId,
          cashflowEntryId: cashflowId,
        },
      });
    } catch {
      // Ignore unique constraint if already linked
    }
  }
  console.log(`Created ${linkCount} budget item expense links (item ↔ cashflow)`);
}

async function main() {
  console.log("Starting seed data (accounts, cashflow, receipts, budgets)...\n");

  const userId = await getOrCreateSeedUserId();

  const accountCount = randomInt(15, 40);
  const cashflowCount = randomInt(20, 50);
  const receiptCount = randomInt(25, 60);
  const projectCount = randomInt(4, 10);

  // Cashflow entries must each link to an account entry (verified account txns only).
  // Create more account entries than cashflow so some remain unlinked (pending verification) for testing.
  const unlinkedExtra = randomInt(5, 20);
  const accountCountForSeed = Math.max(accountCount, cashflowCount + unlinkedExtra);
  const accountEntryIds = await seedAccountEntries(userId, accountCountForSeed);
  const cashflowEntryIds = await seedCashflowEntries(userId, accountEntryIds, cashflowCount);
  await seedReceiptSubmissions(cashflowEntryIds, receiptCount, userId);

  const projectIds = await seedBudgetProjects(userId, projectCount);
  const budgetItemIds = await seedBudgetItems(projectIds);
  await seedBudgetItemExpenses(budgetItemIds, cashflowEntryIds);

  console.log("\nSeed data complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
