import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";
import { DEFAULT_APP_NAME } from "@panditas/shared";

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
  // Display name used in email subjects/bodies. The web app's nav/title has
  // its own VITE_APP_NAME (build-time), kept in sync only by sharing this default.
  APP_NAME: z.string().default(DEFAULT_APP_NAME),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 32 bytes as 64 hex chars"),
  SYNC_CRON: z.string().default("0 */6 * * *"),
  // Runs a daily check for periodic (week/quarter/half/year) finance summary
  // emails to all adults. Unlike SYNC_CRON, this has NO default — unset means
  // disabled, since it's new/unverified content going to every adult's inbox
  // and SMTP may already be live. Suggested value once ready: "0 8 * * *".
  SUMMARY_CRON: z.string().optional(),
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
