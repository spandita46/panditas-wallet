import type { FastifyInstance } from "fastify";
import { isLiability, type AccountDTO, type AccountType, type DashboardSummary } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { toAccountDTO, toTransactionDTO } from "../mappers.js";

const STALE_MS = 1000 * 60 * 60 * 24 * 2; // 2 days
// How long a tracked account may lag its institution's lastSyncedAt before
// it's flagged orphaned — comfortably wider than one missed sync cycle
// (SYNC_CRON defaults to every 6h) so a single blip isn't a false positive,
// but still catches "stopped appearing in the feed" within about a day.
const ORPHAN_TOLERANCE_MS = 1000 * 60 * 60 * 25; // 25 hours
const SWING_THRESHOLD_PCT = 10;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // Family financial dashboard — adults/admin only.
  app.get("/summary", { preHandler: requireRole("admin", "adult") }, async () => {
    const accounts = await prisma.account.findMany({
      where: { isClosed: false, isTracked: true },
      include: { institution: true, mergedInto: { select: { name: true, label: true } } },
    });
    const dtos = accounts.map(toAccountDTO);

    let assets = 0;
    let liabilities = 0;
    for (const a of dtos) {
      if (a.isLiability) liabilities += Math.abs(a.currentBalance);
      else assets += a.currentBalance;
    }

    const accountsByType = {} as Record<AccountType, AccountDTO[]>;
    for (const a of dtos) (accountsByType[a.type] ??= []).push(a);

    const recent = await prisma.transaction.findMany({
      where: { account: { isTracked: true, isClosed: false } },
      take: 15,
      orderBy: { postedAt: "desc" },
      include: {
        account: { select: { name: true, label: true } },
        category: { select: { name: true } },
        transferAccount: { select: { name: true, label: true } },
      },
    });

    const institutions = await prisma.institution.findMany({
      where: { provider: "simplefin" },
    });
    const now = Date.now();
    const staleInstitutions = institutions
      .filter(
        (i) =>
          i.status !== "ok" ||
          !i.lastSyncedAt ||
          now - i.lastSyncedAt.getTime() > STALE_MS,
      )
      .map((i) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        statusMessage: i.statusMessage,
        lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
      }));

    // New accounts/institutions — a persisted, deliberate acknowledgment
    // (not a self-expiring "created recently" window), so it can't be missed
    // by someone who happens not to look for a few days.
    const newAccounts = dtos
      .filter((a) => a.isNew)
      .map((a) => ({ id: a.id, name: a.displayName, institutionName: a.institutionName ?? "Manual" }));
    const newInstitutions = institutions
      .filter((i) => !i.newAcknowledgedAt)
      .map((i) => ({ id: i.id, name: i.name }));

    // Orphaned: still tracked, but its institution synced fine while this
    // particular account wasn't touched — the mirror image of "new account
    // appeared under the same institution," and a strong merge candidate.
    const instById = new Map(institutions.map((i) => [i.id, i]));
    const orphanCandidates = await prisma.account.findMany({
      where: { isTracked: true, isClosed: false, institutionId: { not: null }, mergedIntoId: null },
      select: { id: true, name: true, label: true, institutionId: true, lastSyncedAt: true },
    });
    const orphanedAccounts = orphanCandidates
      .filter((a) => {
        const inst = a.institutionId ? instById.get(a.institutionId) : undefined;
        if (!inst || inst.status !== "ok" || !inst.lastSyncedAt) return false;
        if (!a.lastSyncedAt) return true;
        return inst.lastSyncedAt.getTime() - a.lastSyncedAt.getTime() > ORPHAN_TOLERANCE_MS;
      })
      .map((a) => ({ id: a.id, name: a.label ?? a.name, institutionId: a.institutionId! }));

    // Net-worth swing — diff the two most recent checkpoints syncAll() writes.
    // Only populated when actually beyond threshold, same "only actionable
    // entries" convention as staleInstitutions above.
    const [latestCheckpoint, prevCheckpoint] = await prisma.netWorthCheckpoint.findMany({
      orderBy: { computedAt: "desc" },
      take: 2,
    });
    let netWorthSwing: DashboardSummary["netWorthSwing"] = null;
    if (latestCheckpoint && prevCheckpoint) {
      const pctChange = (before: number, after: number) => (before !== 0 ? ((after - before) / before) * 100 : null);
      const assetsPctChange = pctChange(Number(prevCheckpoint.assetsTotal), Number(latestCheckpoint.assetsTotal));
      const liabilitiesPctChange = pctChange(
        Number(prevCheckpoint.liabilitiesTotal),
        Number(latestCheckpoint.liabilitiesTotal),
      );
      if (
        (assetsPctChange !== null && Math.abs(assetsPctChange) > SWING_THRESHOLD_PCT) ||
        (liabilitiesPctChange !== null && Math.abs(liabilitiesPctChange) > SWING_THRESHOLD_PCT)
      ) {
        netWorthSwing = { assetsPctChange, liabilitiesPctChange };
      }
    }

    const lastRun = await prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" }, select: { finishedAt: true } });

    const summary: DashboardSummary = {
      netWorth: {
        currency: "CAD",
        assets: round(assets),
        liabilities: round(liabilities),
        netWorth: round(assets - liabilities),
        asOf: new Date().toISOString(),
      },
      creditCards: dtos.filter((a) => a.type === "credit_card"),
      recentTransactions: recent.map(toTransactionDTO),
      accountsByType,
      staleInstitutions,
      newAccounts,
      newInstitutions,
      orphanedAccounts,
      netWorthSwing,
      lastSyncFinishedAt: lastRun?.finishedAt?.toISOString() ?? null,
    };
    return summary;
  });
}

const round = (n: number) => Math.round(n * 100) / 100;
