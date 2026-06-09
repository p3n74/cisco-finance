/**
 * End-to-end integration tests for grouped cashflow verification.
 *
 * Covers amount integrity, verification state, link-table invariants, and
 * authorization. Runs against DATABASE_URL (local fin_db recommended).
 *
 * Run: bun run --cwd packages/api test:e2e
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../../apps/server/.env") });
config({ path: path.resolve(__dirname, "../../../../.env") });

const { prisma } = await import("@cisco-finance/db");
const { appRouter } = await import("./index");
const testSetup = await import("../test/setup");
const { makeTestContext, testEmail, testRunId } = testSetup;
type TestRole = testSetup.TestRole;

const createdAccountEntryIds: string[] = [];
const createdCashflowEntryIds: string[] = [];

let testUserId: string;
let editorCaller: ReturnType<typeof appRouter.createCaller>;
let treasurerCaller: ReturnType<typeof appRouter.createCaller>;

function callerFor(role: TestRole) {
	return appRouter.createCaller(makeTestContext(prisma, testUserId, role));
}

async function createAccountEntry(
	amount: number,
	opts?: { account?: "GCash" | "GoTyme" | "Cash" | "BPI"; description?: string },
) {
	const entry = await editorCaller.accountEntries.create({
		date: new Date("2026-06-01"),
		description: opts?.description ?? `${testRunId} account ${amount}`,
		account: opts?.account ?? "GCash",
		amount,
	});
	createdAccountEntryIds.push(entry.id);
	return entry;
}

async function expectTrpcError(
	promise: Promise<unknown>,
	code: TRPCError["code"],
	messageIncludes?: string,
) {
	try {
		await promise;
		throw new Error("Expected TRPCError but call succeeded");
	} catch (error) {
		expect(error).toBeInstanceOf(TRPCError);
		const trpcError = error as TRPCError;
		expect(trpcError.code).toBe(code);
		if (messageIncludes) {
			expect(trpcError.message).toContain(messageIncludes);
		}
	}
}

beforeAll(async () => {
	const user = await prisma.user.create({
		data: {
			id: testRunId,
			name: "Grouped Verification E2E",
			email: testEmail,
			emailVerified: true,
		},
	});
	testUserId = user.id;

	await prisma.authorizedUser.create({
		data: {
			email: testEmail,
			role: "VP_FINANCE",
		},
	});

	editorCaller = callerFor("VP_FINANCE");
	treasurerCaller = callerFor("TREASURER");
});

afterAll(async () => {
	await prisma.cashflowAccountEntryLink.deleteMany({
		where: {
			OR: [
				{ cashflowEntryId: { in: createdCashflowEntryIds } },
				{ accountEntryId: { in: createdAccountEntryIds } },
			],
		},
	});
	await prisma.cashflowEntry.deleteMany({
		where: { id: { in: createdCashflowEntryIds } },
	});
	await prisma.accountEntry.deleteMany({
		where: { id: { in: createdAccountEntryIds } },
	});
	await prisma.activityLog.deleteMany({ where: { userId: testUserId } });
	await prisma.authorizedUser.deleteMany({ where: { email: testEmail } });
	await prisma.user.deleteMany({ where: { id: testUserId } });
});

describe("grouped verification — money integrity", () => {
	test("sums linked account amounts server-side (ignores tampered client total)", async () => {
		const a = await createAccountEntry(150);
		const b = await createAccountEntry(250);
		const c = await createAccountEntry(100);

		const cashflow = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-02"),
			description: `${testRunId} grouped revenue`,
			category: "Revenue",
			amount: 1, // deliberately wrong — server must recompute
			accountEntryIds: [a.id, b.id, c.id],
		});
		createdCashflowEntryIds.push(cashflow.id);

		const stored = await prisma.cashflowEntry.findUniqueOrThrow({
			where: { id: cashflow.id },
		});
		expect(Number(stored.amount)).toBe(500);
		expect(stored.accountEntryId).toBeNull();

		const links = await prisma.cashflowAccountEntryLink.findMany({
			where: { cashflowEntryId: cashflow.id },
			orderBy: { accountEntryId: "asc" },
		});
		expect(links).toHaveLength(3);
		expect(new Set(links.map((l) => l.accountEntryId))).toEqual(
			new Set([a.id, b.id, c.id]),
		);
	});

	test("single-entry verification keeps legacy accountEntryId and one link", async () => {
		const entry = await createAccountEntry(75);

		const cashflow = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-03"),
			description: `${testRunId} single verify`,
			category: "Revenue",
			amount: 75,
			accountEntryIds: [entry.id],
		});
		createdCashflowEntryIds.push(cashflow.id);

		const stored = await prisma.cashflowEntry.findUniqueOrThrow({
			where: { id: cashflow.id },
		});
		expect(stored.accountEntryId).toBe(entry.id);
		expect(Number(stored.amount)).toBe(75);

		const links = await prisma.cashflowAccountEntryLink.findMany({
			where: { cashflowEntryId: cashflow.id },
		});
		expect(links).toHaveLength(1);
		expect(links[0]?.accountEntryId).toBe(entry.id);
	});

	test("resyncAmountsFromAccounts realigns grouped cashflow after account edits", async () => {
		const a = await createAccountEntry(40);
		const b = await createAccountEntry(60);

		const cashflow = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-04"),
			description: `${testRunId} resync target`,
			category: "Revenue",
			amount: 100,
			accountEntryIds: [a.id, b.id],
		});
		createdCashflowEntryIds.push(cashflow.id);

		await editorCaller.accountEntries.update({
			id: a.id,
			date: new Date("2026-06-01"),
			description: `${testRunId} resync a`,
			account: "GCash",
			amount: 55,
		});

		const result = await editorCaller.cashflowEntries.resyncAmountsFromAccounts();
		expect(result.updated).toBeGreaterThanOrEqual(1);

		const stored = await prisma.cashflowEntry.findUniqueOrThrow({
			where: { id: cashflow.id },
		});
		expect(Number(stored.amount)).toBe(115);
	});
});

describe("grouped verification — state & visibility", () => {
	test("verified grouped entries disappear from unverified list and show verified on accounts", async () => {
		const a = await createAccountEntry(20);
		const b = await createAccountEntry(30);

		const cashflow = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-05"),
			description: `${testRunId} visibility check`,
			category: "Revenue",
			amount: 50,
			accountEntryIds: [a.id, b.id],
		});
		createdCashflowEntryIds.push(cashflow.id);

		const unverified = await editorCaller.accountEntries.listUnverified();
		expect(unverified.some((e) => e.id === a.id)).toBe(false);
		expect(unverified.some((e) => e.id === b.id)).toBe(false);

		const accountsPage = await editorCaller.accountEntries.listPage({
			limit: 100,
			offset: 0,
			statusFilter: "verified",
			search: testRunId,
		});
		const verifiedRows = accountsPage.items.filter((e) =>
			[a.id, b.id].includes(e.id),
		);
		expect(verifiedRows).toHaveLength(2);
		for (const row of verifiedRows) {
			expect(row.isVerified).toBe(true);
			expect(row.cashflowEntry?.id).toBe(cashflow.id);
			expect(row.cashflowEntry?.description).toBe(`${testRunId} visibility check`);
		}
	});

	test("cashflow listPage exposes all linked account entries for grouped row", async () => {
		const a = await createAccountEntry(11, { description: `${testRunId} link-a` });
		const b = await createAccountEntry(22, { description: `${testRunId} link-b` });

		const cashflow = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-06"),
			description: `${testRunId} linked list`,
			category: "Revenue",
			amount: 33,
			accountEntryIds: [a.id, b.id],
		});
		createdCashflowEntryIds.push(cashflow.id);

		const page = await editorCaller.cashflowEntries.listPage({
			limit: 20,
			offset: 0,
			search: `${testRunId} linked list`,
		});
		const row = page.items.find((e) => e.id === cashflow.id);
		expect(row).toBeDefined();
		expect(row?.linkedAccountEntriesCount).toBe(2);
		expect(row?.linkedAccountEntries?.map((e) => e.id).sort()).toEqual(
			[a.id, b.id].sort(),
		);
		expect(Number(row?.amount)).toBe(33);
	});

	test("unverified filter excludes grouped-verified entries only", async () => {
		const verified = await createAccountEntry(5);
		const stillUnverified = await createAccountEntry(8);

		const cashflow = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-07"),
			description: `${testRunId} filter split`,
			category: "Revenue",
			amount: 5,
			accountEntryIds: [verified.id],
		});
		createdCashflowEntryIds.push(cashflow.id);

		const unverifiedPage = await editorCaller.accountEntries.listPage({
			limit: 100,
			offset: 0,
			statusFilter: "unverified",
			search: testRunId,
		});
		const ids = unverifiedPage.items.map((e) => e.id);
		expect(ids).toContain(stillUnverified.id);
		expect(ids).not.toContain(verified.id);
	});
});

describe("grouped verification — validation guards", () => {
	test("rejects mixed accounts", async () => {
		const gcash = await createAccountEntry(10, { account: "GCash" });
		const bpi = await createAccountEntry(10, { account: "BPI" });

		await expectTrpcError(
			editorCaller.cashflowEntries.create({
				date: new Date("2026-06-08"),
				description: `${testRunId} mixed accounts`,
				category: "Revenue",
				amount: 20,
				accountEntryIds: [gcash.id, bpi.id],
			}),
			"BAD_REQUEST",
			"same account",
		);
	});

	test("rejects mixed signs (inflow + outflow)", async () => {
		const inflow = await createAccountEntry(50);
		const outflow = await createAccountEntry(-25);

		await expectTrpcError(
			editorCaller.cashflowEntries.create({
				date: new Date("2026-06-09"),
				description: `${testRunId} mixed signs`,
				category: "Revenue",
				amount: 25,
				accountEntryIds: [inflow.id, outflow.id],
			}),
			"BAD_REQUEST",
			"same sign",
		);
	});

	test("rejects already-verified account entry", async () => {
		const entry = await createAccountEntry(12);
		const first = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-10"),
			description: `${testRunId} first verify`,
			category: "Revenue",
			amount: 12,
			accountEntryIds: [entry.id],
		});
		createdCashflowEntryIds.push(first.id);

		const other = await createAccountEntry(15);

		await expectTrpcError(
			editorCaller.cashflowEntries.create({
				date: new Date("2026-06-11"),
				description: `${testRunId} double verify`,
				category: "Revenue",
				amount: 27,
				accountEntryIds: [entry.id, other.id],
			}),
			"BAD_REQUEST",
			"already verified",
		);
	});

	test("blocks archiving a grouped-verified account entry", async () => {
		const entry = await createAccountEntry(9);
		const cashflow = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-12"),
			description: `${testRunId} archive guard`,
			category: "Revenue",
			amount: 9,
			accountEntryIds: [entry.id],
		});
		createdCashflowEntryIds.push(cashflow.id);

		await expectTrpcError(
			treasurerCaller.accountEntries.archive({ id: entry.id }),
			"BAD_REQUEST",
			"Cannot archive",
		);
	});
});

describe("grouped verification — authorization", () => {
	test("treasurer cannot create cashflow verifications", async () => {
		const entry = await treasurerCaller.accountEntries.create({
			date: new Date("2026-06-13"),
			description: `${testRunId} treasurer account`,
			account: "GCash",
			amount: 17,
		});
		createdAccountEntryIds.push(entry.id);

		await expectTrpcError(
			treasurerCaller.cashflowEntries.create({
				date: new Date("2026-06-13"),
				description: `${testRunId} treasurer verify attempt`,
				category: "Revenue",
				amount: 17,
				accountEntryIds: [entry.id],
			}),
			"FORBIDDEN",
			"Only VP Finance and Auditor",
		);

		// Entry must remain unverified — no silent partial write
		const unverified = await editorCaller.accountEntries.listUnverified();
		expect(unverified.some((e) => e.id === entry.id)).toBe(true);
		const links = await prisma.cashflowAccountEntryLink.findMany({
			where: { accountEntryId: entry.id },
		});
		expect(links).toHaveLength(0);
	});
});

describe("grouped verification — link table invariants", () => {
	test("each account entry links to at most one cashflow entry", async () => {
		const entry = await createAccountEntry(44);
		const cashflow = await editorCaller.cashflowEntries.create({
			date: new Date("2026-06-14"),
			description: `${testRunId} unique link`,
			category: "Revenue",
			amount: 44,
			accountEntryIds: [entry.id],
		});
		createdCashflowEntryIds.push(cashflow.id);

		let duplicateFailed = false;
		try {
			await prisma.cashflowAccountEntryLink.create({
				data: {
					cashflowEntryId: cashflow.id,
					accountEntryId: entry.id,
				},
			});
		} catch {
			duplicateFailed = true;
		}
		expect(duplicateFailed).toBe(true);

		const linkCount = await prisma.cashflowAccountEntryLink.count({
			where: { accountEntryId: entry.id },
		});
		expect(linkCount).toBe(1);
	});
});
