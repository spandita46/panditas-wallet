import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { syncAll } from "./sync.js";

// Schedule the background SimpleFIN sync (runs while the machine is awake).
export function startScheduler(log: FastifyBaseLogger): void {
  if (!cron.validate(env.SYNC_CRON)) {
    log.warn(`Invalid SYNC_CRON "${env.SYNC_CRON}" — background sync disabled`);
    return;
  }
  cron.schedule(env.SYNC_CRON, async () => {
    const count = await prisma.simplefinConnection.count();
    if (count === 0) return; // nothing connected yet
    log.info("Running scheduled SimpleFIN sync…");
    const summary = await syncAll();
    log.info({ summary }, "Scheduled sync complete");
  });
  log.info(`Background sync scheduled: ${env.SYNC_CRON}`);
}
