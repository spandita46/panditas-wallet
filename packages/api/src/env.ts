import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

// Load the monorepo-root .env regardless of which package cwd we run from.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((x) => x.trim())),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 chars"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 32 bytes as 64 hex chars"),
  SYNC_CRON: z.string().default("0 */6 * * *"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = envSchema.parse(process.env);
