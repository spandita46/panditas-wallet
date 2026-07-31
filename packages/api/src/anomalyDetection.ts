// Post-sync/post-import anomaly detection — the permanent version of the
// one-off `node scratch/*.mjs` duplicate-hunting scripts this feature grew
// out of. Runs after every syncAll() and every commitImportRows(); flags
// possible duplicates into TransactionAnomaly for an admin to review, rather
// than requiring a manual audit.
import { createHash } from "node:crypto";
import { prisma } from "./db.js";
import { PENDING_MARKER, PENDING_MATCH_WINDOW_MS } from "./duplicateHeuristics.js";

function fingerprint(kind: string, ids: string[]): string {
  const sorted = [...ids].sort();
  return createHash("sha256").update(`${kind}:${sorted.join(",")}`).digest("hex");
}

// If either side of an open anomaly was soft-deleted (or otherwise no longer
// exists), the condition it flagged is gone — close it out automatically so
// dismissed/resolved items don't need manual bookkeeping every time an admin
// acts on one from the detail panel instead of the review queue.
async function autoResolveStale(): Promise<void> {
  const open = await prisma.transactionAnomaly.findMany({ where: { status: "open" } });
  if (open.length === 0) return;
  const allIds = [...new Set(open.flatMap((a) => a.transactionIds))];
  const stillPresent = await prisma.transaction.findMany({ where: { id: { in: allIds } }, select: { id: true } });
  const presentIds = new Set(stillPresent.map((t) => t.id));
  for (const a of open) {
    if (!a.transactionIds.every((id) => presentIds.has(id))) {
      await prisma.transactionAnomaly.update({
        where: { id: a.id },
        data: { status: "resolved", resolutionNote: "auto-resolved — underlying transaction changed", reviewedAt: new Date() },
      });
    }
  }
}

interface Candidate {
  id: string;
  accountId: string;
  postedAt: Date;
  amount: unknown; // Prisma.Decimal
  description: string | null;
}

/**
 * Scans for two duplicate signatures, cheapest/highest-confidence first:
 *  - pending_shadow_duplicate: same account/amount, posted within
 *    PENDING_MATCH_WINDOW_MS, one side's description still says "pending" —
 *    the exact TD/SimpleFIN pending->posted-reissue signature found and
 *    fixed in sync.ts this session.
 *  - same_amount_same_day: same account/date/amount, no pending marker.
 *    Deliberately broad and low-confidence — real coincidental same-amount
 *    same-day transactions exist in this household's data (insurance
 *    installments, transit top-ups), so this always requires human review,
 *    never auto-acts.
 */
export async function detectAnomalies(since: Date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)): Promise<{ created: number }> {
  await autoResolveStale();

  const recent = await prisma.transaction.findMany({ where: { createdAt: { gte: since } }, select: { accountId: true } });
  const accountIds = [...new Set(recent.map((t) => t.accountId))];
  if (accountIds.length === 0) return { created: 0 };

  const pool: Candidate[] = await prisma.transaction.findMany({
    where: { accountId: { in: accountIds } },
    select: { id: true, accountId: true, postedAt: true, amount: true, description: true },
  });

  const byAccount = new Map<string, Candidate[]>();
  for (const t of pool) {
    if (!byAccount.has(t.accountId)) byAccount.set(t.accountId, []);
    byAccount.get(t.accountId)!.push(t);
  }

  let created = 0;
  const seenThisRun = new Set<string>();

  for (const txns of byAccount.values()) {
    for (let i = 0; i < txns.length; i++) {
      for (let j = i + 1; j < txns.length; j++) {
        const a = txns[i]!;
        const b = txns[j]!;
        if (Number(a.amount) !== Number(b.amount)) continue;
        const dateDiffMs = Math.abs(a.postedAt.getTime() - b.postedAt.getTime());
        const hasPendingMarker = PENDING_MARKER.test(a.description ?? "") || PENDING_MARKER.test(b.description ?? "");

        let kind: string | null = null;
        let detail = "";
        if (hasPendingMarker && dateDiffMs <= PENDING_MATCH_WINDOW_MS) {
          kind = "pending_shadow_duplicate";
          detail =
            'Same account/amount, posted within a few days of each other, and one row\'s description still says "pending" — likely the same real transaction under two different external ids.';
        } else if (a.postedAt.toISOString().slice(0, 10) === b.postedAt.toISOString().slice(0, 10)) {
          kind = "same_amount_same_day";
          detail =
            "Same account/date/amount across two rows — could be the same real transaction duplicated, or a genuine coincidence (e.g. two separate charges of the same amount). Verify before deleting either.";
        }
        if (!kind) continue;

        const ids = [a.id, b.id];
        const fp = fingerprint(kind, ids);
        if (seenThisRun.has(fp)) continue;
        seenThisRun.add(fp);

        // fingerprint is the stable identity across re-runs — if it already
        // exists (open, dismissed, or resolved), leave it alone rather than
        // reopening a dismissed item or duplicating an existing one.
        const alreadyKnown = await prisma.transactionAnomaly.findUnique({ where: { fingerprint: fp }, select: { id: true } });
        if (alreadyKnown) continue;

        await prisma.transactionAnomaly.create({ data: { kind, fingerprint: fp, transactionIds: ids, detail } });
        created++;
      }
    }
  }

  return { created };
}
