import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { BENEFICIARIES, tagTransactionSchema, type TransactionListResponse } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { recategorizeAll } from "../categorize.js";
import { toTransactionDTO } from "../mappers.js";

const listQuerySchema = z.object({
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  untaggedCategory: z.coerce.boolean().optional(),
  beneficiary: z.enum(BENEFICIARIES).optional(),
  untaggedBeneficiary: z.coerce.boolean().optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
  // Arbitrary date range (inclusive), as an alternative to `month`.
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const withRelations = {
  account: { select: { name: true, label: true } },
  category: { select: { name: true } },
  beneficiaryUser: { select: { name: true } },
  transferAccount: { select: { name: true, label: true } },
} as const;

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  // List transactions (adults/admin) — for review and tagging.
  app.get("/", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const { accountId, categoryId, untaggedCategory, beneficiary, untaggedBeneficiary, month, from, to, search, limit, offset } =
      parsed.data;

    let postedAt: Prisma.TransactionWhereInput["postedAt"];
    if (from || to) {
      // Custom range: `to` is inclusive of the whole day.
      postedAt = {
        ...(from && { gte: new Date(`${from}T00:00:00.000Z`) }),
        ...(to && { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000) }),
      };
    } else if (month) {
      const start = new Date(`${month}T00:00:00.000Z`);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      postedAt = { gte: start, lt: end };
    }

    const where: Prisma.TransactionWhereInput = {
      account: { isTracked: true, isClosed: false },
      ...(accountId && { accountId }),
      ...(categoryId && { categoryId }),
      ...(untaggedCategory && { categoryId: null }),
      ...(beneficiary && { beneficiary }),
      ...(untaggedBeneficiary && { beneficiary: null }),
      ...(postedAt && { postedAt }),
      ...(search && {
        OR: [
          { payee: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [txns, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: withRelations,
        orderBy: { postedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.transaction.count({ where }),
    ]);

    const response: TransactionListResponse = { items: txns.map(toTransactionDTO), total };
    return response;
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

  // Retroactively apply current category rules. ?all=1 also overwrites already-tagged ones.
  app.post("/recategorize", { preHandler: requireRole("admin", "adult") }, async (request) => {
    const { all } = request.query as { all?: string };
    const updated = await recategorizeAll(all !== "1");
    return { updated };
  });
}
