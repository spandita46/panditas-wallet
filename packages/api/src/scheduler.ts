import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { syncAll } from "./sync.js";
import { runPeriodicSummaries } from "./periodicSummary.js";

// Schedule the background SimpleFIN sync (runs while the machine is awake).
export function startScheduler(log: FastifyBaseLogger): void {
  if (!cron.validate(env.SYNC_CRON)) {
    log.warn(`Invalid SYNC_CRON "${env.SYNC_CRON}" — background sync disabled`);
  } else {
    cron.schedule(env.SYNC_CRON, async () => {
      const count = await prisma.simplefinConnection.count();
      if (count === 0) return; // nothing connected yet
      log.info("Running scheduled SimpleFIN sync…");
      const summary = await syncAll();
      log.info({ summary }, "Scheduled sync complete");
    });
    log.info(`Background sync scheduled: ${env.SYNC_CRON}`);
  }

  // Periodic (week/quarter/half/year) finance summary emails — off by default
  // (see SUMMARY_CRON in env.ts). One cron job, one email template
  // parameterized by which period(s) closed the day before it runs.
  if (env.SUMMARY_CRON) {
    if (!cron.validate(env.SUMMARY_CRON)) {
      log.warn(`Invalid SUMMARY_CRON "${env.SUMMARY_CRON}" — periodic summary emails disabled`);
    } else {
      cron.schedule(env.SUMMARY_CRON, async () => {
        log.info("Checking for periodic finance summaries to send…");
        await runPeriodicSummaries();
      });
      log.info(`Periodic finance summary scheduled: ${env.SUMMARY_CRON}`);
    }
  }
}
