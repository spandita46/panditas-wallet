import { isLiability, type AccountType } from "@panditas/shared";
import { prisma } from "./db.js";

/** Total tracked assets/liabilities right now — the same isLiability-based
 * summation dashboard.ts uses, extracted so syncAll()'s swing-detection
 * checkpoint can never drift from how the dashboard itself computes net worth. */
export async function computeTrackedNetWorthTotals(): Promise<{ assets: number; liabilities: number }> {
  const accounts = await prisma.account.findMany({
    where: { isClosed: false, isTracked: true },
    select: { type: true, currentBalance: true },
  });
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    const bal = Number(a.currentBalance);
    if (isLiability(a.type as AccountType)) liabilities += Math.abs(bal);
    else assets += bal;
  }
  return { assets: round(assets), liabilities: round(liabilities) };
}

const round = (n: number) => Math.round(n * 100) / 100;
