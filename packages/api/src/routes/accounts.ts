import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ACCOUNT_TYPES,
  createManualAccountSchema,
  updateBalanceSchema,
  type AccountBalancePoint,
} from "@panditas/shared";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { toAccountDTO } from "../mappers.js";

const dayOfMonth = z.number().int().min(1).max(31).nullable().optional();

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  label: z.string().max(60).nullable().optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  ownerUserId: z.string().nullable().optional(),
  isClosed: z.boolean().optional(),
  isTracked: z.boolean().optional(),
  // Dismisses the "New" badge — always stamped as "now" server-side, never
  // client-suppliable as an arbitrary date.
  acknowledgeNew: z.literal(true).optional(),
  // Manual bill-cycle config — meaningful for credit_card accounts only, but
  // not enforced here (harmless if set on another type; UI only offers it
  // for credit cards).
  statementDay: dayOfMonth,
  dueDay: dayOfMonth,
  suppressTransactionSync: z.boolean().optional(),
});

const mergeSchema = z.object({ intoAccountId: z.string().min(1) });

const withMergedInto = { institution: true, mergedInto: { select: { name: true, label: true } } } as const;

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // List accounts. Kids only ever see their own (piggy bank) accounts.
  app.get("/", { preHandler: requireAuth }, async (request) => {
    const user = request.user!;
    const where =
      user.role === "kid" ? { ownerUserId: user.id, isClosed: false } : { isClosed: false };
    const accounts = await prisma.account.findMany({
      where,
      include: withMergedInto,
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    const pendingSums = await prisma.transaction.groupBy({
      by: ["accountId"],
      where: { pending: true, accountId: { in: accounts.map((a) => a.id) } },
      _sum: { amount: true },
    });
    const pendingByAccount = new Map(pendingSums.map((s) => [s.accountId, Number(s._sum.amount ?? 0)]));
    return accounts.map((a) => toAccountDTO(a, pendingByAccount.get(a.id) ?? 0));
  });

  // Create a manual account (Coinbase, cash, piggy bank, etc.). Admin-only config.
  app.post("/manual", { preHandler: requireRole("admin") }, async (request, reply) => {
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
      include: withMergedInto,
    });
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, balance: account.currentBalance },
    });
    return reply.code(201).send(toAccountDTO(account));
  });

  // Update a manual account's balance (and snapshot it for history). Admin-only config.
  app.patch("/:id/balance", { preHandler: requireRole("admin") }, async (request, reply) => {
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
      include: withMergedInto,
    });
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, balance: account.currentBalance },
    });
    return toAccountDTO(account);
  });

  // Correct a synced account's type/name (the sync guesses the type on first import). Admin-only config.
  app.patch("/:id", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateAccountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Account not found" });

    const { acknowledgeNew, ...rest } = parsed.data;
    const account = await prisma.account.update({
      where: { id },
      data: { ...rest, ...(acknowledgeNew && { newAcknowledgedAt: new Date() }) },
      include: withMergedInto,
    });
    return toAccountDTO(account);
  });

  // Mark this account as the same real-world entity as `intoAccountId` — the
  // fix for a SimpleFIN reconnect producing a duplicate account. Same
  // institution only; merges into a root only (shallow star topology, no
  // chained/recursive merges), so "merge a third account into an already-
  // merged pair" just means merging into that pair's existing root.
  app.post("/:id/merge", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = mergeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "intoAccountId is required" });
    const { intoAccountId } = parsed.data;
    if (intoAccountId === id) return reply.code(400).send({ error: "Cannot merge an account into itself" });

    const [source, target] = await Promise.all([
      prisma.account.findUnique({ where: { id } }),
      prisma.account.findUnique({ where: { id: intoAccountId } }),
    ]);
    if (!source || !target) return reply.code(404).send({ error: "Account not found" });
    if (source.mergedIntoId) return reply.code(400).send({ error: "This account is already merged" });
    if (target.mergedIntoId) {
      return reply.code(400).send({ error: "Target is itself a merged account — merge into its root instead" });
    }
    if (!source.institutionId || source.institutionId !== target.institutionId) {
      return reply.code(400).send({ error: "Accounts can only be merged within the same institution" });
    }

    const account = await prisma.$transaction(async (tx) => {
      const updated = await tx.account.update({
        where: { id },
        data: { mergedIntoId: intoAccountId, isTracked: false },
        include: withMergedInto,
      });
      // Existing auto-tag/auto-link rules referencing the old account should
      // keep firing against the account that's actually still live.
      await tx.categoryRuleCondition.updateMany({ where: { matchAccountId: id }, data: { matchAccountId: intoAccountId } });
      await tx.categoryRule.updateMany({ where: { linkedAccountId: id }, data: { linkedAccountId: intoAccountId } });
      return updated;
    });
    return toAccountDTO(account);
  });

  // Undo a merge. Note: CategoryRule repointing done at merge time is NOT
  // reverted (would require remembering pre-merge values) — this is a safety
  // net for "undo a mistake," not a perfect inverse.
  app.post("/:id/unmerge", { preHandler: requireRole("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Account not found" });
    if (!existing.mergedIntoId) return reply.code(400).send({ error: "Account is not merged" });

    const account = await prisma.account.update({
      where: { id },
      data: { mergedIntoId: null, isTracked: true },
      include: withMergedInto,
    });
    return toAccountDTO(account);
  });

  // Balance-over-time for one account, from captured snapshots (every sync +
  // manual balance edit) — powers the Dashboard composition drill-down.
  // Resolves to the whole merge group (root + any leaves merged into it) for
  // continuous history across a reconnect boundary.
  app.get("/:id/balance-history", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) return reply.code(404).send({ error: "Account not found" });

    const rootId = account.mergedIntoId ?? account.id;
    const group = await prisma.account.findMany({
      where: { OR: [{ id: rootId }, { mergedIntoId: rootId }] },
      select: { id: true },
    });

    const snapshots = await prisma.balanceSnapshot.findMany({
      where: { accountId: { in: group.map((a) => a.id) } },
      orderBy: { capturedAt: "asc" },
    });
    const history: AccountBalancePoint[] = snapshots.map((s) => ({
      date: s.capturedAt.toISOString(),
      balance: Number(s.balance),
    }));
    return history;
  });
}
