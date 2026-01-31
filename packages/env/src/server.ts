import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1).optional().default("postgresql://postgres:postgres@localhost:5432/postgres"),
    BETTER_AUTH_SECRET: z.string().min(1).optional().default("a-very-long-secret-that-is-at-least-32-chars"),
    BETTER_AUTH_URL: z.string().optional().default("http://localhost:3000"),
    CORS_ORIGIN: z.string().optional().default("http://localhost:5173"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional().default("placeholder"),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional().default("placeholder"),
    EMAIL_PROVIDER: z.string().min(1).optional().default("gmail"),
    EMAIL_FROM: z.string().email().optional().default("placeholder@gmail.com"),
    EMAIL_PASSWORD: z.string().min(1).optional().default("placeholder"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().optional().default(3000),
    HOST: z.string().optional().default("0.0.0.0"), // Bind address (0.0.0.0 for Cloud Run, localhost for local dev)
    // 32-byte key for AES-256-GCM (use base64 or any string; server hashes to 32 bytes). Set in production.
    CHAT_ENCRYPTION_KEY: z.string().min(16).optional().default("cisco-finance-chat-dev-key-change-in-production"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
