import { prisma } from "./db.js";

interface Rule {
  id: string;
  categoryId: string;
  matchType: "account" | "payee_contains" | "description_regex";
  matchAccountId: string | null;
  pattern: string | null;
  priority: number;
}

interface TxnLike {
  accountId: string;
  payee: string | null;
  description: string | null;
}

/** Highest priority first; ties broken by rule id for stable ordering. */
export async function loadRules(): Promise<Rule[]> {
  const rules = await prisma.categoryRule.findMany({ orderBy: [{ priority: "desc" }, { id: "asc" }] });
  return rules as Rule[];
}

export function matchCategory(txn: TxnLike, rules: Rule[]): string | null {
  for (const rule of rules) {
    if (rule.matchType === "account") {
      if (rule.matchAccountId && rule.matchAccountId === txn.accountId) return rule.categoryId;
      continue;
    }
    if (rule.matchType === "payee_contains") {
      if (!rule.pattern) continue;
      const haystack = `${txn.payee ?? ""} ${txn.description ?? ""}`.toLowerCase();
      if (haystack.includes(rule.pattern.toLowerCase())) return rule.categoryId;
      continue;
    }
    if (rule.matchType === "description_regex") {
      if (!rule.pattern) continue;
      try {
        const re = new RegExp(rule.pattern, "i");
        if (re.test(txn.description ?? "") || re.test(txn.payee ?? "")) return rule.categoryId;
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
    const categoryId = matchCategory(txn, rules);
    if (categoryId) {
      await prisma.transaction.update({ where: { id: txn.id }, data: { categoryId } });
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
    const categoryId = matchCategory(txn, rules);
    if (categoryId) {
      await prisma.transaction.update({ where: { id: txn.id }, data: { categoryId } });
      updated++;
    }
  }
  return updated;
}
