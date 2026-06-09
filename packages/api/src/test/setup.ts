import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const testRunId = `e2e-gv-${Date.now()}`;
export const testEmail = `${testRunId}@cisco-finance.test`;

export type TestRole = "VP_FINANCE" | "AUDITOR" | "TREASURER" | null;

export function makeTestContext(
	prisma: import("@cisco-finance/db").PrismaClientType,
	userId: string,
	role: TestRole,
) {
	return {
		session: {
			user: {
				id: userId,
				email: testEmail,
				name: "Grouped Verification E2E",
				emailVerified: true,
				image: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			session: {
				id: `${testRunId}-session`,
				userId,
				expiresAt: new Date(Date.now() + 86_400_000),
				token: `${testRunId}-token`,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		},
		userRole: role,
		prisma,
		ws: null,
		getPresenceMap: () => ({}),
		clientIp: "127.0.0.1",
	};
}
