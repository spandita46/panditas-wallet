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
  // When true, the API also serves the built web app (single-port LAN/NAS deploy).
  SERVE_WEB: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Optional email notifications when a SimpleFIN institution/connection breaks.
  // Left unset, notifications are skipped (logged, not fatal) — email is not a
  // hard requirement for sync to keep working.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Defaults to the seeded admin's email when unset.
  NOTIFY_EMAIL_TO: z.string().optional(),
  // Used only to build a link back to the app in notification emails.
  APP_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);
