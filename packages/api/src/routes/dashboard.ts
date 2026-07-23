import type { FastifyInstance } from "fastify";
import { isLiability, type AccountDTO, type AccountType, type DashboardSummary } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { toAccountDTO, toTransactionDTO } from "../mappers.js";
import { getUpcomingBills } from "../periodicSummary.js";
import { listActiveNotifications } from "../notificationCenter.js";

const UPCOMING_BILLS_HORIZON_DAYS = 14;

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
}

const round = (n: number) => Math.round(n * 100) / 100;
