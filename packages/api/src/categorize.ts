import { prisma } from "./db.js";

interface Rule {
  id: string;
  categoryId: string;
  matchType: "account" | "payee_contains" | "description_regex";
  matchAccountId: string | null;
  pattern: string | null;
  priority: number;
  linkedAccountId: string | null;
}

interface TxnLike {
  accountId: string;
  payee: string | null;
  description: string | null;
}

interface MatchResult {
  categoryId: string;
  // Set when the matched rule auto-links a transfer counterpart account.
  linkedAccountId: string | null;
}

/** Highest priority first; ties broken by rule id for stable ordering. */
export async function loadRules(): Promise<Rule[]> {
  const rules = await prisma.categoryRule.findMany({ orderBy: [{ priority: "desc" }, { id: "asc" }] });
  return rules as Rule[];
}

export function matchCategory(txn: TxnLike, rules: Rule[]): MatchResult | null {
  for (const rule of rules) {
    if (rule.matchType === "account") {
      if (rule.matchAccountId && rule.matchAccountId === txn.accountId) {
        return { categoryId: rule.categoryId, linkedAccountId: rule.linkedAccountId };
      }
      continue;
    }
    if (rule.matchType === "payee_contains") {
      if (!rule.pattern) continue;
      const haystack = `${txn.payee ?? ""} ${txn.description ?? ""}`.toLowerCase();
      if (haystack.includes(rule.pattern.toLowerCase())) {
        return { categoryId: rule.categoryId, linkedAccountId: rule.linkedAccountId };
      }
      continue;
    }
    if (rule.matchType === "description_regex") {
      if (!rule.pattern) continue;
      try {
        const re = new RegExp(rule.pattern, "i");
        if (re.test(txn.description ?? "") || re.test(txn.payee ?? "")) {
          return { categoryId: rule.categoryId, linkedAccountId: rule.linkedAccountId };
        }
      } catch {
        continue; // ignore an invalid regex rather than fail the whole categorize pass
      }
    }
  }
  return null;
}

/** Categorize a batch of newly-created transactions in place (used by sync). */
export async function categorizeNewTransactions(transactionIds: string[]): Promise<number> {
  if (transactionIds.length === 0) return 0;
  const rules = await loadRules();
  if (rules.length === 0) return 0;

  const txns = await prisma.transaction.findMany({
    where: { id: { in: transactionIds } },
    select: { id: true, accountId: true, payee: true, description: true },
  });

  let updated = 0;
  for (const txn of txns) {
    const match = matchCategory(txn, rules);
    if (match) {
      await prisma.transaction.update({
        where: { id: txn.id },
        data: {
          categoryId: match.categoryId,
          ...(match.linkedAccountId && { transferAccountId: match.linkedAccountId }),
        },
      });
      updated++;
    }
  }
  return updated;
}

/** Re-apply current rules to existing transactions. onlyUncategorized limits it to gaps. */
export async function recategorizeAll(onlyUncategorized: boolean): Promise<number> {
  const rules = await loadRules();
  if (rules.length === 0) return 0;

  const txns = await prisma.transaction.findMany({
    where: onlyUncategorized ? { categoryId: null } : {},
    select: { id: true, accountId: true, payee: true, description: true },
  });

  let updated = 0;
  for (const txn of txns) {
    const match = matchCategory(txn, rules);
    if (match) {
      await prisma.transaction.update({
        where: { id: txn.id },
        data: {
          categoryId: match.categoryId,
          ...(match.linkedAccountId && { transferAccountId: match.linkedAccountId }),
        },
      });
      updated++;
    }
  }
  return updated;
}
