import type { FastifyInstance } from "fastify";
import type { Account } from "@prisma/client";
import { addPiggyTxnSchema, type PiggyBankData } from "@panditas/shared";
import type { Role } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";
import { toAccountDTO, toTransactionDTO } from "../mappers.js";

// Resolve which piggy bank to act on. Kids can only ever touch their own; an
// admin/adult may target a kid's via ?userId (e.g. helping), else the first.
async function resolvePiggy(role: Role, userId: string, targetUserId?: string): Promise<Account | null> {
  if (role === "kid") {
    return prisma.account.findFirst({
      where: { ownerUserId: userId, type: "piggy_bank", isClosed: false },
    });
  }
  return prisma.account.findFirst({
    where: {
      type: "piggy_bank",
      isClosed: false,
      ...(targetUserId ? { ownerUserId: targetUserId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}

const txnInclude = {
  account: { select: { name: true, label: true } },
  category: { select: { name: true } },
  beneficiaryUser: { select: { name: true } },
  transferAccount: { select: { name: true, label: true } },
} as const;

export async function piggyBankRoutes(app: FastifyInstance): Promise<void> {
  // The kid's piggy bank: account, recent transactions, and balance history.
  app.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { userId } = request.query as { userId?: string };
    const account = await resolvePiggy(user.role, user.id, userId);
    if (!account) return reply.code(404).send({ error: "No piggy bank found" });

    const [txns, snapshots, full] = await Promise.all([
      prisma.transaction.findMany({
        where: { accountId: account.id },
        orderBy: { postedAt: "desc" },
        take: 100,
        include: txnInclude,
      }),
      prisma.balanceSnapshot.findMany({
        where: { accountId: account.id },
        orderBy: { capturedAt: "asc" },
      }),
      prisma.account.findUnique({ where: { id: account.id }, include: { institution: true } }),
    ]);

    const data: PiggyBankData = {
      account: toAccountDTO(full!),
      transactions: txns.map(toTransactionDTO),
      history: snapshots.map((s) => ({ date: s.capturedAt.toISOString(), balance: Number(s.balance) })),
    };
    return data;
  });

  // Add money (direction "in") or spend (direction "out").
  app.post("/transactions", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const parsed = addPiggyTxnSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { userId } = request.query as { userId?: string };

    const account = await resolvePiggy(user.role, user.id, userId);
    if (!account) return reply.code(404).send({ error: "No piggy bank found" });

    const signed = parsed.data.direction === "in" ? parsed.data.amount : -parsed.data.amount;
    const newBalance = Number(account.currentBalance) + signed;
    if (newBalance < 0) {
      return reply.code(400).send({ error: "Not enough in the piggy bank yet!" });
    }

    await prisma.transaction.create({
      data: {
        accountId: account.id,
        amount: signed,
        description: parsed.data.description,
        payee: parsed.data.description,
        source: "manual",
        postedAt: new Date(),
      },
    });
    await prisma.account.update({
      where: { id: account.id },
      data: { currentBalance: newBalance, lastSyncedAt: new Date() },
    });
    await prisma.balanceSnapshot.create({ data: { accountId: account.id, balance: newBalance } });

    return reply.code(201).send({ ok: true, balance: newBalance });
  });

  // Undo a transaction (fix a mistake).
  app.delete("/transactions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { userId } = request.query as { userId?: string };

    const account = await resolvePiggy(user.role, user.id, userId);
    if (!account) return reply.code(404).send({ error: "No piggy bank found" });

    const txn = await prisma.transaction.findUnique({ where: { id } });
    if (!txn || txn.accountId !== account.id) return reply.code(404).send({ error: "Not found" });

    const newBalance = Number(account.currentBalance) - Number(txn.amount);
    await prisma.transaction.delete({ where: { id } });
    await prisma.account.update({ where: { id: account.id }, data: { currentBalance: newBalance } });
    await prisma.balanceSnapshot.create({ data: { accountId: account.id, balance: newBalance } });

    return reply.code(204).send();
  });
}
