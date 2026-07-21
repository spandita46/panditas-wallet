import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Beneficiary, DailyFlowPoint, SpendingBreakdown, SpendingBreakdownEntry } from "@panditas/shared";
import { BENEFICIARY_LABELS } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "month must be YYYY-MM-01"),
});

const timeseriesQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(12).default(3),
});

export async function insightsRoutes(app: FastifyInstance): Promise<void> {
  // Spending broken down by who paid (account owner) and who it was for (beneficiary).
  app.get("/spending", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = monthQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "month must be YYYY-MM-01" });
    const monthDate = new Date(`${parsed.data.month}T00:00:00.000Z`);
    const monthEnd = new Date(monthDate);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

    // Expense transactions only (amount < 0), from tracked accounts, for the month.
    // Transfers (e.g. credit card payments) are excluded — the original card-side
    // purchase is already counted, so including the payment too would double-count.
    const txns = await prisma.transaction.findMany({
      where: {
        postedAt: { gte: monthDate, lt: monthEnd },
        amount: { lt: 0 },
        account: { isTracked: true, isClosed: false },
        NOT: { category: { kind: "transfer" } },
      },
      select: {
        amount: true,
        beneficiary: true,
        beneficiaryUserId: true,
        beneficiaryUser: { select: { name: true } },
        account: { select: { ownerUserId: true, owner: { select: { name: true } } } },
      },
    });

    const byOwner = new Map<string, SpendingBreakdownEntry>();
    const byBeneficiary = new Map<string, SpendingBreakdownEntry>();

    for (const t of txns) {
      const amt = -Number(t.amount); // positive = spent

      const ownerKey = t.account.ownerUserId ?? "shared";
      const ownerLabel = t.account.owner?.name ?? "Shared";
      const ownerEntry = byOwner.get(ownerKey) ?? { key: ownerKey, label: ownerLabel, total: 0 };
      ownerEntry.total += amt;
      byOwner.set(ownerKey, ownerEntry);

      const beneficiary = t.beneficiary as Beneficiary | null;
      const benKey = beneficiary === "family_member" && t.beneficiaryUserId ? t.beneficiaryUserId : (beneficiary ?? "untagged");
      const benLabel =
        beneficiary === "family_member" && t.beneficiaryUser
          ? t.beneficiaryUser.name
          : beneficiary
            ? BENEFICIARY_LABELS[beneficiary]
            : "Untagged";
      const benEntry = byBeneficiary.get(benKey) ?? { key: benKey, label: benLabel, total: 0 };
      benEntry.total += amt;
      byBeneficiary.set(benKey, benEntry);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const sortDesc = (a: SpendingBreakdownEntry, b: SpendingBreakdownEntry) => b.total - a.total;

    const result: SpendingBreakdown = {
      month: parsed.data.month,
      byOwner: [...byOwner.values()].map((e) => ({ ...e, total: round(e.total) })).sort(sortDesc),
      byBeneficiary: [...byBeneficiary.values()].map((e) => ({ ...e, total: round(e.total) })).sort(sortDesc),
    };
    return result;
  });

  // Daily income/expense totals for the dashboard's calendar heatmap + trend
  // chart. Small household-scale dataset — aggregated in JS rather than a
  // SQL date-trunc grouping.
  app.get("/timeseries", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = timeseriesQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });

    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - parsed.data.months);

    const txns = await prisma.transaction.findMany({
      where: {
        postedAt: { gte: start, lte: end },
        account: { isTracked: true, isClosed: false },
        NOT: { category: { kind: "transfer" } },
      },
      select: { postedAt: true, amount: true },
    });

    const byDay = new Map<string, { income: number; expense: number }>();
    for (const t of txns) {
      const day = t.postedAt.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? { income: 0, expense: 0 };
      const amt = Number(t.amount);
      if (amt >= 0) entry.income += amt;
      else entry.expense += -amt;
      byDay.set(day, entry);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const result: DailyFlowPoint[] = [...byDay.entries()]
      .map(([date, v]) => ({ date, income: round(v.income), expense: round(v.expense) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return result;
  });
}
