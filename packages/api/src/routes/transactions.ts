import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BENEFICIARIES, tagTransactionSchema } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { toTransactionDTO } from "../mappers.js";

const listQuerySchema = z.object({
  accountId: z.string().optional(),
  beneficiary: z.enum(BENEFICIARIES).optional(),
  untaggedBeneficiary: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const withRelations = {
  account: { select: { name: true, label: true } },
  category: { select: { name: true } },
  beneficiaryUser: { select: { name: true } },
} as const;

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  // List transactions (adults/admin) — for review and tagging.
  app.get("/", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const { accountId, beneficiary, untaggedBeneficiary, limit, offset } = parsed.data;

    const txns = await prisma.transaction.findMany({
      where: {
        account: { isTracked: true, isClosed: false },
        ...(accountId && { accountId }),
        ...(beneficiary && { beneficiary }),
        ...(untaggedBeneficiary && { beneficiary: null }),
      },
      include: withRelations,
      orderBy: { postedAt: "desc" },
      take: limit,
      skip: offset,
    });
    return txns.map(toTransactionDTO);
  });

  // Tag a transaction: category and/or beneficiary (who the spend was for).
  app.patch("/:id", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = tagTransactionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const data = parsed.data;

    // Only keep a beneficiary user when the beneficiary is a specific family member.
    if (data.beneficiary && data.beneficiary !== "family_member") {
      data.beneficiaryUserId = null;
    }

    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Transaction not found" });

    const txn = await prisma.transaction.update({
      where: { id },
      data,
      include: withRelations,
    });
    return toTransactionDTO(txn);
  });
}
