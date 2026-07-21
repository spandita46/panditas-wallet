import type { FastifyInstance } from "fastify";
import { isLiability, type AccountDTO, type AccountType, type DashboardSummary } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { toAccountDTO, toTransactionDTO } from "../mappers.js";

const STALE_MS = 1000 * 60 * 60 * 24 * 2; // 2 days

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // Family financial dashboard — adults/admin only.
  app.get("/summary", { preHandler: requireRole("admin", "adult") }, async () => {
    const accounts = await prisma.account.findMany({
      where: { isClosed: false, isTracked: true },
      include: { institution: true },
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
        lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
      }));

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
    };
    return summary;
  });
}

const round = (n: number) => Math.round(n * 100) / 100;
