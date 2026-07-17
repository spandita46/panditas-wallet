import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACCOUNT_TYPES, createManualAccountSchema, updateBalanceSchema } from "@panditas/shared";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { toAccountDTO } from "../mappers.js";

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  label: z.string().max(60).nullable().optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  ownerUserId: z.string().nullable().optional(),
  isClosed: z.boolean().optional(),
  isTracked: z.boolean().optional(),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // List accounts. Kids only ever see their own (piggy bank) accounts.
  app.get("/", { preHandler: requireAuth }, async (request) => {
    const user = request.user!;
    const where =
      user.role === "kid" ? { ownerUserId: user.id, isClosed: false } : { isClosed: false };
    const accounts = await prisma.account.findMany({
      where,
      include: { institution: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return accounts.map(toAccountDTO);
  });

  // Create a manual account (Coinbase, cash, piggy bank, etc.).
  app.post("/manual", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = createManualAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const account = await prisma.account.create({
      data: {
        name: parsed.data.name,
        type: parsed.data.type,
        currency: parsed.data.currency,
        currentBalance: parsed.data.currentBalance,
        ownerUserId: parsed.data.ownerUserId ?? null,
        isManual: true,
        lastSyncedAt: new Date(),
      },
      include: { institution: true },
    });
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, balance: account.currentBalance },
    });
    return reply.code(201).send(toAccountDTO(account));
  });

  // Update a manual account's balance (and snapshot it for history).
  app.patch("/:id/balance", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateBalanceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Account not found" });
    if (!existing.isManual) {
      return reply.code(400).send({ error: "Only manual accounts can be edited directly" });
    }

    const account = await prisma.account.update({
      where: { id },
      data: { currentBalance: parsed.data.currentBalance, lastSyncedAt: new Date() },
      include: { institution: true },
    });
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, balance: account.currentBalance },
    });
    return toAccountDTO(account);
  });

  // Correct a synced account's type/name (the sync guesses the type on first import).
  app.patch("/:id", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Account not found" });

    const account = await prisma.account.update({
      where: { id },
      data: parsed.data,
      include: { institution: true },
    });
    return toAccountDTO(account);
  });
}
