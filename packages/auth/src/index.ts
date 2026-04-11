import { expo } from "@better-auth/expo";
import { env } from "@cisco-finance/env/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const isAccelerate =
	env.DATABASE_URL.startsWith("prisma://") ||
	env.DATABASE_URL.startsWith("prisma+postgres://");

const basePrisma = isAccelerate
	? new PrismaClient({ accelerateUrl: env.DATABASE_URL })
	: new PrismaClient({
			adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
		});

const prisma = isAccelerate
	? basePrisma.$extends(withAccelerate())
	: basePrisma;

export const auth = betterAuth({
	database: prismaAdapter(prisma, {
		provider: "postgresql",
	}),

	trustedOrigins: [env.CORS_ORIGIN, "mybettertapp://", "exp://"],
	emailAndPassword: {
		enabled: true,
	},
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
		},
	},
	advanced: {
		defaultCookieAttributes: {
			sameSite: env.NODE_ENV === "production" ? "none" : "lax",
			secure: env.NODE_ENV === "production",
			httpOnly: true,
		},
	},
	plugins: [expo()],
});
