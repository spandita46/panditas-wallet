import { SIMPLEFIN_BRIDGE_URL } from "@panditas/shared";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { sendMail } from "./mailer.js";

async function resolveRecipient(): Promise<string | null> {
  if (env.NOTIFY_EMAIL_TO) return env.NOTIFY_EMAIL_TO;
  const admin = await prisma.user.findFirst({
    where: { role: "admin", isActive: true, email: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  return admin?.email ?? null;
}

export function appLink(path: string): string | null {
  if (!env.APP_URL) return null;
  return `${env.APP_URL.replace(/\/+$/, "")}${path}`;
}

/** One-time alert on the ok/never_synced -> auth_required/error transition for
 * a single institution. Callers are responsible for only calling this on an
 * actual transition (not on every sync while it stays broken). */
export async function notifyInstitutionBroken(institution: {
  name: string;
  status: "auth_required" | "error";
  statusMessage: string | null;
}): Promise<void> {
  const to = await resolveRecipient();
  if (!to) return; // no NOTIFY_EMAIL_TO / seeded admin email — nothing to send to

  const reason =
    institution.status === "auth_required" ? "needs re-authentication" : "reported a sync error";
  const settingsUrl = appLink("/settings");
  const lines = [
    `${institution.name} ${reason} on your last SimpleFIN sync.`,
    institution.statusMessage ? `Details: ${institution.statusMessage}` : null,
    settingsUrl
      ? `Open ${env.APP_NAME}: ${settingsUrl}`
      : `Open ${env.APP_NAME}'s Settings page to see connection health.`,
    `Reconnect on SimpleFIN's own dashboard: ${SIMPLEFIN_BRIDGE_URL}`,
  ].filter((l): l is string => Boolean(l));

  await sendMail({
    to,
    subject: `${env.APP_NAME}: ${institution.name} needs reconnecting`,
    text: lines.join("\n\n"),
  });
}

/** One-time alert when a whole SimpleFIN connection (access URL) starts
 * failing — broader than a single institution needing re-auth. */
export async function notifyConnectionBroken(connection: {
  label: string | null;
  statusMessage: string | null;
}): Promise<void> {
  const to = await resolveRecipient();
  if (!to) return;

  const name = connection.label ?? "Your SimpleFIN connection";
  const settingsUrl = appLink("/settings");
  const lines = [
    `${name} failed on your last SimpleFIN sync — this affects every institution under this connection, not just one.`,
    connection.statusMessage ? `Details: ${connection.statusMessage}` : null,
    settingsUrl
      ? `Open ${env.APP_NAME}: ${settingsUrl}`
      : `Open ${env.APP_NAME}'s Settings page to see connection health.`,
    `Reconnect on SimpleFIN's own dashboard: ${SIMPLEFIN_BRIDGE_URL}`,
  ].filter((l): l is string => Boolean(l));

  await sendMail({
    to,
    subject: `${env.APP_NAME}: ${name} disconnected`,
    text: lines.join("\n\n"),
  });
}
