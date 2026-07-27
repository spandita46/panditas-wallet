import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveAnomalySchema, type TransactionAnomalyDTO } from "@panditas/shared";
import { requireRole } from "../auth.js";
import { prisma } from "../db.js";
import { toTransactionAnomalyDTO } from "../mappers.js";

// Admin-only: reviewing/dismissing/resolving flagged data-quality issues is a
// data-normalization action, same bar as folder sync's approve routes.
export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.get("/anomalies", { preHandler: requireRole("admin") }, async (request) => {
    const { status } = z.object({ status: z.enum(["open", "dismissed", "resolved"]).default("open") }).parse(request.query);

    const anomalies = await prisma.transactionAnomaly.findMany({
      where: { status },
      orderBy: { detectedAt: "desc" },
      include: { reviewedByUser: { select: { name: true } } },
    });

    const allTxnIds = [...new Set(anomalies.flatMap((a) => a.transactionIds))];
    const txns =
      allTxnIds.length === 0
        ? []
        : await prisma.transaction.findMany({
            where: { id: { in: allTxnIds }, deletedAt: undefined },
            select: {
              id: true,
              accountId: true,
              postedAt: true,
              amount: true,
              payee: true,
              source: true,
              deletedAt: true,
              account: { select: { name: true, label: true } },
            },
          });
    const txnById = new Map(txns.map((t) => [t.id, t]));

    const result: TransactionAnomalyDTO[] = anomalies.map((a) => toTransactionAnomalyDTO(a, txnById));
    return result;
  });

  app.post("/anomalies/:id/dismiss", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const user = request.user!;
    const existing = await prisma.transactionAnomaly.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Not found" });
    await prisma.transactionAnomaly.update({
      where: { id },
      data: { status: "dismissed", reviewedAt: new Date(), reviewedByUserId: user.id },
    });
    return reply.code(204).send();
  });

  app.post("/anomalies/:id/resolve", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const parsed = resolveAnomalySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const user = request.user!;
    const existing = await prisma.transactionAnomaly.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Not found" });
    await prisma.transactionAnomaly.update({
      where: { id },
      data: {
        status: "resolved",
        reviewedAt: new Date(),
        reviewedByUserId: user.id,
        resolutionNote: parsed.data.note ?? null,
      },
    });
    return reply.code(204).send();
  });
}
