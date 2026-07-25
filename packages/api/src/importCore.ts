// Shared preview/commit logic for bulk transaction import — used by both the
// manual CSV-import route (transactions.ts) and folder sync (folderSync.ts),
// which just supply already-normalized rows from a different source.
import { recategorizeAll } from "./categorize.js";
import { prisma } from "./db.js";
import type { ImportCommitResponse, ImportPreviewResponse, ImportRow } from "@panditas/shared";

// Flags likely duplicates (same account, date, amount) for the user to review
// before committing; not exact dedup, since imported rows have no externalId
// to match on.
export async function previewImportRows(accountId: string, rows: ImportRow[]): Promise<ImportPreviewResponse> {
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
}

// Historical backfill only — deliberately does NOT touch currentBalance/
// BalanceSnapshot, since the account's current balance is already correct
// from sync (or manual edits) and isn't affected by filling in older history.
export async function commitImportRows(accountId: string, rows: ImportRow[]): Promise<ImportCommitResponse> {
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

  return { imported: rows.length, recategorized };
}
