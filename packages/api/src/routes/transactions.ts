import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  BENEFICIARIES,
  createManualTransactionSchema,
  importCommitSchema,
  importPreviewSchema,
  linkTransferSchema,
  tagTransactionSchema,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type TransactionListResponse,
  type TransferSuggestionDTO,
} from "@panditas/shared";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { recategorizeAll } from "../categorize.js";
import { toTransactionDTO } from "../mappers.js";

const listQuerySchema = z.object({
  accountId: z.string().optional(),
  // Filters to every account under one institution (e.g. "all Wealthsimple
  // transactions"). Ignored when accountId is also set — a specific account
  // is the more precise ask.
  institutionId: z.string().optional(),
  categoryId: z.string().optional(),
  // Comma-separated category ids — for "filter by this whole budget group"
  // deep links. Takes precedence over categoryId/untaggedCategory when set.
  categoryIds: z.string().optional(),
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
  // Off by default — untracked accounts (exploratory/should-be-closed ones)
  // stay out of the day-to-day view unless explicitly asked for.
  includeUntracked: z.coerce.boolean().optional(),
  // Dollar amount filter, as an absolute value — matches both expenses and
  // income/refunds of that magnitude regardless of sign.
  minAmount: z.coerce.number().nonnegative().optional(),
  maxAmount: z.coerce.number().nonnegative().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

/** Absolute-value amount range, expressed as a Prisma filter over the signed amount column. */
function amountFilter(min?: number, max?: number): Prisma.TransactionWhereInput {
  if (min !== undefined && max !== undefined) {
    return {
      OR: [
        { amount: { gte: min, lte: max } },
        { amount: { gte: -max, lte: -min } },
      ],
    };
  }
  if (min !== undefined) {
    return { OR: [{ amount: { gte: min } }, { amount: { lte: -min } }] };
  }
  if (max !== undefined) {
    return { amount: { gte: -max, lte: max } };
  }
  return {};
}

const withRelations = {
  account: { select: { name: true, label: true } },
  category: { select: { name: true, kind: true } },
  beneficiaryUser: { select: { name: true } },
  transferAccount: { select: { name: true, label: true } },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Same day = 90%, within 3 days = 75%, within 2 weeks = 50%, beyond that: not suggested. */
function confidenceForDayGap(diffDays: number): number | null {
  if (diffDays === 0) return 90;
  if (diffDays <= 3) return 75;
  if (diffDays <= 14) return 50;
  return null;
}

/**
 * Suggest (never apply) likely transfer counterparts for a batch of source
 * transactions: opposite sign, exact same magnitude, a different account,
 * within a 2-week window. Each source and each candidate is used at most
 * once (greedy, highest-confidence first) so ambiguous same-amount
 * coincidences don't get double-claimed.
 */
async function computeTransferSuggestions(
  sources: { id: string; accountId: string; amount: Prisma.Decimal; postedAt: Date }[],
): Promise<Map<string, TransferSuggestionDTO>> {
  const result = new Map<string, TransferSuggestionDTO>();
  if (sources.length === 0) return result;

  const times = sources.map((s) => s.postedAt.getTime());
  const windowStart = new Date(Math.min(...times) - 14 * DAY_MS);
  const windowEnd = new Date(Math.max(...times) + 14 * DAY_MS);

  const pool = await prisma.transaction.findMany({
    where: {
      postedAt: { gte: windowStart, lte: windowEnd },
      pending: false,
      transferAccountId: null,
      account: { isTracked: true, isClosed: false },
      OR: [{ categoryId: null }, { category: { kind: "transfer" } }],
    },
    select: {
      id: true,
      accountId: true,
      amount: true,
      postedAt: true,
      account: { select: { name: true, label: true } },
    },
  });

  interface Pair {
    sourceId: string;
    candidateId: string;
    accountId: string;
    accountName: string;
    confidence: number;
    diffDays: number;
  }
  const pairs: Pair[] = [];

  for (const source of sources) {
    const sourceAmt = Number(source.amount);
    for (const cand of pool) {
      if (cand.id === source.id || cand.accountId === source.accountId) continue;
      const candAmt = Number(cand.amount);
      if (Math.abs(candAmt + sourceAmt) > 0.005) continue; // not an exact opposite-sign match
      const diffDays = Math.round(Math.abs(source.postedAt.getTime() - cand.postedAt.getTime()) / DAY_MS);
      const confidence = confidenceForDayGap(diffDays);
      if (confidence === null) continue;
      pairs.push({
        sourceId: source.id,
        candidateId: cand.id,
        accountId: cand.accountId,
        accountName: cand.account.label ?? cand.account.name,
        confidence,
        diffDays,
      });
    }
  }

  pairs.sort((a, b) => b.confidence - a.confidence || a.diffDays - b.diffDays);
  const usedSources = new Set<string>();
  const usedCandidates = new Set<string>();
  for (const p of pairs) {
    if (usedSources.has(p.sourceId) || usedCandidates.has(p.candidateId)) continue;
    result.set(p.sourceId, {
      candidateTransactionId: p.candidateId,
      accountId: p.accountId,
      accountName: p.accountName,
      confidence: p.confidence,
    });
    usedSources.add(p.sourceId);
    usedCandidates.add(p.candidateId);
  }

  return result;
}

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  // List transactions (adults/admin) — for review and tagging.
  app.get("/", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    const {
      accountId,
      institutionId,
      categoryId,
      categoryIds,
      untaggedCategory,
      beneficiary,
      untaggedBeneficiary,
      month,
      from,
      to,
      search,
      includeUntracked,
      minAmount,
      maxAmount,
      limit,
      offset,
    } = parsed.data;

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

    // AND-array (rather than spreading multiple OR blocks into one object) so
    // the search filter and the amount filter — each their own OR — coexist
    // instead of one clobbering the other's key.
    const categoryIdList = categoryIds ? categoryIds.split(",").filter(Boolean) : undefined;

    // Filtering by a specific account also pulls in any account merged into
    // it (e.g. the old account from a SimpleFIN reconnect) — a merged-away
    // account is deliberately isTracked:false, so it must bypass the generic
    // tracked/open filter below rather than be silently excluded by it.
    const accountIdList = accountId
      ? [
          accountId,
          ...(await prisma.account.findMany({ where: { mergedIntoId: accountId }, select: { id: true } })).map(
            (a) => a.id,
          ),
        ]
      : undefined;

    const where: Prisma.TransactionWhereInput = {
      ...(accountIdList
        ? { accountId: { in: accountIdList } }
        : {
            account: {
              isClosed: false,
              ...(includeUntracked ? {} : { isTracked: true }),
              ...(institutionId && { institutionId }),
            },
          }),
      ...(categoryIdList
        ? { categoryId: { in: categoryIdList } }
        : categoryId
          ? { categoryId }
          : untaggedCategory
            ? { categoryId: null }
            : {}),
      ...(beneficiary && { beneficiary }),
      ...(untaggedBeneficiary && { beneficiary: null }),
      ...(postedAt && { postedAt }),
      AND: [
        ...(search
          ? [
              {
                OR: [
                  { payee: { contains: search, mode: "insensitive" as const } },
                  { description: { contains: search, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
        ...(minAmount !== undefined || maxAmount !== undefined ? [amountFilter(minAmount, maxAmount)] : []),
      ],
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

    // Suggest transfer links for currently-unlinked, not-yet-categorized (or
    // already transfer-tagged) transactions on this page. Suggestions are
    // informational only — nothing here is written to the database.
    const eligibleSources = txns.filter(
      (t) => !t.transferAccountId && !t.pending && (t.categoryId === null || t.category?.kind === "transfer"),
    );
    const suggestions = await computeTransferSuggestions(eligibleSources);

    const response: TransactionListResponse = {
      items: txns.map((t) => ({ ...toTransactionDTO(t), transferSuggestion: suggestions.get(t.id) ?? null })),
      total,
    };
    return response;
  });

  // Record a transaction the bank feed won't capture — cash, a reporting
  // gap, backfilling before SimpleFIN was connected. Works on any account,
  // synced or manual. Also nudges the account's balance and snapshots it,
  // since there's no sync to pick up the change otherwise; a later SimpleFIN
  // sync overwrites currentBalance wholesale anyway, so this is only ever a
  // stopgap for synced accounts, same as it is the source of truth for manual ones.
  app.post("/manual", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const parsed = createManualTransactionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const account = await prisma.account.findUnique({ where: { id: parsed.data.accountId } });
    if (!account) return reply.code(404).send({ error: "Account not found" });

    const [txn, updatedAccount] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          accountId: parsed.data.accountId,
          postedAt: new Date(`${parsed.data.postedAt}T00:00:00.000Z`),
          amount: parsed.data.amount,
          payee: parsed.data.payee ?? null,
          description: parsed.data.description ?? null,
          categoryId: parsed.data.categoryId ?? null,
          source: "manual",
        },
        include: withRelations,
      }),
      prisma.account.update({
        where: { id: parsed.data.accountId },
        data: { currentBalance: { increment: parsed.data.amount } },
      }),
    ]);
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, balance: updatedAccount.currentBalance },
    });

    return reply.code(201).send(toTransactionDTO(txn));
  });

  // Bulk import (a bank export beyond SimpleFIN's 90-day window). File
  // parsing and column mapping happen client-side — this only ever sees
  // already-normalized rows. Flags likely duplicates (same account, date,
  // amount) for the user to review before committing; not exact dedup, since
  // imported rows have no externalId to match on. Admin-only, same as other
  // structural account/transaction bulk operations.
  app.post("/import/preview", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = importPreviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { accountId, rows } = parsed.data;

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return reply.code(404).send({ error: "Account not found" });

    const dates = rows.map((r) => new Date(`${r.postedAt}T00:00:00.000Z`));
    const existing = await prisma.transaction.findMany({
      where: {
        accountId,
        postedAt: { gte: new Date(Math.min(...dates.map((d) => d.getTime()))), lte: new Date(Math.max(...dates.map((d) => d.getTime()))) },
      },
      select: { postedAt: true, amount: true },
    });
    const existingKeys = new Set(existing.map((t) => `${t.postedAt.toISOString().slice(0, 10)}|${Number(t.amount)}`));

    const result: ImportPreviewResponse = {
      rows: rows.map((r, index) => ({
        index,
        postedAt: r.postedAt,
        amount: r.amount,
        payee: r.payee ?? null,
        memo: r.memo ?? null,
        duplicate: existingKeys.has(`${r.postedAt}|${r.amount}`),
      })),
      duplicateCount: 0,
    };
    result.duplicateCount = result.rows.filter((r) => r.duplicate).length;
    return result;
  });

  // Commits rows the user confirmed in the preview step (already excludes
  // whatever they chose to skip). Historical backfill only — deliberately
  // does NOT touch currentBalance/BalanceSnapshot, since the account's
  // current balance is already correct from sync (or from manual edits) and
  // isn't affected by filling in older history.
  app.post("/import/commit", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = importCommitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const { accountId, rows } = parsed.data;

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return reply.code(404).send({ error: "Account not found" });

    await prisma.transaction.createMany({
      data: rows.map((r) => ({
        accountId,
        postedAt: new Date(`${r.postedAt}T00:00:00.000Z`),
        amount: r.amount,
        payee: r.payee ?? null,
        memo: r.memo ?? null,
        source: "manual" as const,
      })),
    });
    const recategorized = await recategorizeAll(true);

    const response: ImportCommitResponse = { imported: rows.length, recategorized };
    return reply.code(201).send(response);
  });

  // Link a transaction to its transfer counterpart (sets transferAccountId on
  // both sides). Re-validates server-side rather than trusting the client.
  app.post("/:id/link-transfer", { preHandler: requireRole("admin", "adult") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = linkTransferSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const [a, b] = await Promise.all([
      prisma.transaction.findUnique({ where: { id } }),
      prisma.transaction.findUnique({ where: { id: parsed.data.counterpartTransactionId } }),
    ]);
    if (!a || !b) return reply.code(404).send({ error: "Transaction not found" });
    if (a.accountId === b.accountId) {
      return reply.code(400).send({ error: "Both transactions are on the same account" });
    }
    if (Math.abs(Number(a.amount) + Number(b.amount)) > 0.005) {
      return reply.code(400).send({ error: "Amounts don't offset — not a valid transfer pair" });
    }
    // Guard against a stale suggestion silently overwriting an already-resolved link.
    if (a.transferAccountId || b.transferAccountId) {
      return reply.code(409).send({ error: "One of these transactions is already linked — refresh and try again." });
    }

    const [updatedA] = await prisma.$transaction([
      prisma.transaction.update({
        where: { id: a.id },
        data: { transferAccountId: b.accountId },
        include: withRelations,
      }),
      prisma.transaction.update({ where: { id: b.id }, data: { transferAccountId: a.accountId } }),
    ]);
    return toTransactionDTO(updatedA);
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
