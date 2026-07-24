import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  isLiability,
  NET_WORTH_HISTORY_RANGES,
  type AccountDTO,
  type AccountType,
  type DashboardSummary,
  type NetWorthHistoryPoint,
} from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { toAccountDTO, toTransactionDTO } from "../mappers.js";
import { getUpcomingBills } from "../periodicSummary.js";
import { listActiveNotifications } from "../notificationCenter.js";

const UPCOMING_BILLS_HORIZON_DAYS = 14;

const RANGE_DAYS: Record<Exclude<(typeof NET_WORTH_HISTORY_RANGES)[number], "all">, number> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
};
const historyQuerySchema = z.object({ range: z.enum(NET_WORTH_HISTORY_RANGES).default("90d") });

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

    const lastRun = await prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" }, select: { finishedAt: true } });

    const upcomingBills = await getUpcomingBills(new Date(), UPCOMING_BILLS_HORIZON_DAYS);
    const notifications = await listActiveNotifications();

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
      notifications,
      lastSyncFinishedAt: lastRun?.finishedAt?.toISOString() ?? null,
      upcomingBills: upcomingBills.map((b) => ({
        ...b,
        dueDate: b.dueDate.toISOString(),
        payments: b.payments.map((p) => ({ ...p, postedAt: p.postedAt.toISOString() })),
      })),
    };
    return summary;
  });

  // Whole-household net worth over time, for the Dashboard's landing chart.
  // Downsamples NetWorthCheckpoint (one row per sync, ~4/day at the default
  // cron) to the last checkpoint of each calendar day — no point plotting
  // every raw sync.
  app.get("/net-worth-history", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid range" });
    const { range } = parsed.data;

    const since = range === "all" ? undefined : new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
    const checkpoints = await prisma.netWorthCheckpoint.findMany({
      where: since ? { computedAt: { gte: since } } : {},
      orderBy: { computedAt: "asc" },
    });

    // Ascending order means a later same-day checkpoint naturally overwrites
    // an earlier one in the map, leaving the day's last value.
    const byDay = new Map<string, (typeof checkpoints)[number]>();
    for (const c of checkpoints) byDay.set(c.computedAt.toISOString().slice(0, 10), c);

    const history: NetWorthHistoryPoint[] = [...byDay.values()].map((c) => ({
      date: c.computedAt.toISOString(),
      assets: Number(c.assetsTotal),
      liabilities: Number(c.liabilitiesTotal),
      netWorth: Number(c.assetsTotal) - Number(c.liabilitiesTotal),
    }));
    return history;
  });
}

const round = (n: number) => Math.round(n * 100) / 100;
