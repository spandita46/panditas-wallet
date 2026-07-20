import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { setBudgetSchema, type BudgetLineDTO, type CategoryKind } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "month must be YYYY-MM-01"),
});

export async function budgetRoutes(app: FastifyInstance): Promise<void> {
  // Per-category limit vs actual spend for a given month.
  app.get("/", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = monthQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "month must be YYYY-MM-01" });
    const monthDate = new Date(`${parsed.data.month}T00:00:00.000Z`);
    const monthEnd = new Date(monthDate);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

    const [categories, monthBudgets, sums] = await Promise.all([
      prisma.category.findMany({ where: { archived: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.budget.findMany({ where: { month: monthDate } }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: {
          postedAt: { gte: monthDate, lt: monthEnd },
          categoryId: { not: null },
          account: { isTracked: true, isClosed: false },
        },
        _sum: { amount: true },
      }),
    ]);

    const overrideByCategory = new Map(monthBudgets.map((b) => [b.categoryId, Number(b.limit)]));
    const sumByCategory = new Map(sums.map((s) => [s.categoryId as string, Number(s._sum.amount ?? 0)]));

    const lines: BudgetLineDTO[] = categories.map((c) => {
      const override = overrideByCategory.get(c.id);
      const rawSum = sumByCategory.get(c.id) ?? 0;
      const kind = c.kind as CategoryKind;
      return {
        categoryId: c.id,
        categoryName: c.name,
        group: c.group,
        kind,
        limit: override ?? (c.monthlyLimit === null ? null : Number(c.monthlyLimit)),
        isDefaultLimit: override === undefined,
        spent: kind === "income" ? rawSum : -rawSum,
      };
    });

    return lines;
  });

  // Set (or clear) a specific month's budget limit for a category.
  app.put("/", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = setBudgetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { categoryId, month, limit } = parsed.data;

    const budget = await prisma.budget.upsert({
      where: { categoryId_month: { categoryId, month: new Date(`${month}T00:00:00.000Z`) } },
      create: { categoryId, month: new Date(`${month}T00:00:00.000Z`), limit },
      update: { limit },
    });
    return { id: budget.id, categoryId: budget.categoryId, limit: Number(budget.limit) };
  });

  // Clear a month's override so the category's default limit applies again.
  app.delete("/", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = monthQuerySchema
      .extend({ categoryId: z.string().min(1) })
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { categoryId, month } = parsed.data;
    await prisma.budget
      .delete({ where: { categoryId_month: { categoryId, month: new Date(`${month}T00:00:00.000Z`) } } })
      .catch(() => null);
    return reply.code(204).send();
  });
}
