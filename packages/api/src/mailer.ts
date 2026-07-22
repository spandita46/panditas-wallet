import nodemailer from "nodemailer";
import { env } from "./env.js";

const transporter =
  env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      })
    : null;

/** Send a plain-text email. No-ops (logging why) when SMTP isn't configured —
 * email is an optional notification channel, never a hard requirement for
 * sync to keep working. */
export async function sendMail(opts: { to: string; subject: string; text: string }): Promise<void> {
  if (!transporter) {
    console.warn(`[mailer] SMTP not configured — skipping email: ${opts.subject}`);
    return;
  }
  await transporter.sendMail({ from: env.SMTP_FROM ?? env.SMTP_USER, ...opts });
}
