import type { Beneficiary } from "@panditas/shared";
import { prisma } from "./db.js";

interface Condition {
  type: "account" | "payee_contains" | "description_regex" | "amount_range";
  matchAccountId: string | null;
  pattern: string | null;
  minAmount: number | null;
  maxAmount: number | null;
}

interface Rule {
  id: string;
  categoryId: string;
  logic: "all" | "any";
  conditions: Condition[];
  linkedAccountId: string | null;
  // Overrides the category's default beneficiary for transactions this rule matches.
  beneficiary: Beneficiary | null;
  beneficiaryUserId: string | null;
}

interface TxnLike {
  accountId: string;
  payee: string | null;
  description: string | null;
  amount: number;
  beneficiary: Beneficiary | null;
}

interface MatchResult {
  categoryId: string;
  linkedAccountId: string | null;
  beneficiary: Beneficiary | null;
  beneficiaryUserId: string | null;
}

/** Highest priority first; ties broken by rule id for stable ordering. */
export async function loadRules(): Promise<Rule[]> {
  const rules = await prisma.categoryRule.findMany({
    orderBy: [{ priority: "desc" }, { id: "asc" }],
    include: { conditions: true },
  });
  return rules.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    logic: r.logic,
    conditions: r.conditions.map((c) => ({
      type: c.type,
      matchAccountId: c.matchAccountId,
      pattern: c.pattern,
      minAmount: c.minAmount === null ? null : Number(c.minAmount),
      maxAmount: c.maxAmount === null ? null : Number(c.maxAmount),
    })),
    linkedAccountId: r.linkedAccountId,
    beneficiary: r.beneficiary,
    beneficiaryUserId: r.beneficiaryUserId,
  }));
}

function conditionMatches(condition: Condition, txn: TxnLike): boolean {
  switch (condition.type) {
    case "account":
      return !!condition.matchAccountId && condition.matchAccountId === txn.accountId;
    case "payee_contains": {
      if (!condition.pattern) return false;
      const haystack = `${txn.payee ?? ""} ${txn.description ?? ""}`.toLowerCase();
      return haystack.includes(condition.pattern.toLowerCase());
    }
    case "description_regex": {
      if (!condition.pattern) return false;
      try {
        const re = new RegExp(condition.pattern, "i");
        return re.test(txn.description ?? "") || re.test(txn.payee ?? "");
      } catch {
        return false; // ignore an invalid regex rather than fail the whole categorize pass
      }
    }
    case "amount_range": {
      // Magnitude, not signed — matches the same convention as the
      // Transactions page's min/max $ filter (catches both an expense and an
      // income/refund of that size regardless of sign).
      const magnitude = Math.abs(txn.amount);
      if (condition.minAmount !== null && magnitude < condition.minAmount) return false;
      if (condition.maxAmount !== null && magnitude > condition.maxAmount) return false;
      return true;
    }
  }
}

/** A rule with no conditions never matches (shouldn't happen — the API
 * requires at least one — but defend against it rather than matching everything). */
export function matchCategory(txn: TxnLike, rules: Rule[]): MatchResult | null {
  for (const rule of rules) {
    if (rule.conditions.length === 0) continue;
    const matched =
      rule.logic === "any"
        ? rule.conditions.some((c) => conditionMatches(c, txn))
        : rule.conditions.every((c) => conditionMatches(c, txn));
    if (matched) {
      return {
        categoryId: rule.categoryId,
        linkedAccountId: rule.linkedAccountId,
        beneficiary: rule.beneficiary,
        beneficiaryUserId: rule.beneficiaryUserId,
      };
    }
  }
  return null;
}

async function loadCategoryDefaultBeneficiaries(): Promise<
  Map<string, { beneficiary: Beneficiary | null; beneficiaryUserId: string | null }>
> {
  const categories = await prisma.category.findMany({
    select: { id: true, defaultBeneficiary: true, defaultBeneficiaryUserId: true },
  });
  return new Map(
    categories.map((c) => [c.id, { beneficiary: c.defaultBeneficiary, beneficiaryUserId: c.defaultBeneficiaryUserId }]),
  );
}

interface CategorizableTxn {
  id: string;
  accountId: string;
  payee: string | null;
  description: string | null;
  amount: unknown; // Prisma.Decimal, kept loosely typed here to avoid importing @prisma/client just for this
  beneficiary: Beneficiary | null;
}

async function applyRules(txns: CategorizableTxn[]): Promise<number> {
  const rules = await loadRules();
  if (rules.length === 0) return 0;
  const categoryDefaults = await loadCategoryDefaultBeneficiaries();

  let updated = 0;
  for (const txn of txns) {
    const match = matchCategory(
      { accountId: txn.accountId, payee: txn.payee, description: txn.description, amount: Number(txn.amount), beneficiary: txn.beneficiary },
      rules,
    );
    if (!match) continue;

    // Beneficiary comes from the rule override OR the category default —
    // never mixed (a rule's own family-member choice shouldn't pair with a
    // different category-level default userId, and vice versa). Only fills
    // in when the transaction doesn't already have one — never overwrites a
    // manual tag.
    const source = match.beneficiary !== null ? { beneficiary: match.beneficiary, beneficiaryUserId: match.beneficiaryUserId } : categoryDefaults.get(match.categoryId);
    const fillBeneficiary = txn.beneficiary === null && source?.beneficiary != null;

    await prisma.transaction.update({
      where: { id: txn.id },
      data: {
        categoryId: match.categoryId,
        ...(match.linkedAccountId && { transferAccountId: match.linkedAccountId }),
        ...(fillBeneficiary && {
          beneficiary: source!.beneficiary,
          ...(source!.beneficiaryUserId && { beneficiaryUserId: source!.beneficiaryUserId }),
        }),
      },
    });
    updated++;
  }
  return updated;
}

/** Fills a category's default beneficiary onto any transaction that already
 * has that category (from a rule OR set manually) but no beneficiary yet.
 * Broader net than applyRules on purpose — a manually-categorized "Food
 * Basics" grocery run should still inherit Groceries' default even though no
 * rule exists for that specific payee. Fill-only, same as everywhere else:
 * never overwrites a beneficiary that's already set. */
async function fillDefaultBeneficiaries(transactionIds?: string[]): Promise<number> {
  const categoryDefaults = await loadCategoryDefaultBeneficiaries();
  const txns = await prisma.transaction.findMany({
    where: {
      beneficiary: null,
      categoryId: { not: null },
      ...(transactionIds ? { id: { in: transactionIds } } : {}),
    },
    select: { id: true, categoryId: true },
  });

  let updated = 0;
  for (const txn of txns) {
    const def = categoryDefaults.get(txn.categoryId!);
    if (!def?.beneficiary) continue;
    await prisma.transaction.update({
      where: { id: txn.id },
      data: { beneficiary: def.beneficiary, ...(def.beneficiaryUserId && { beneficiaryUserId: def.beneficiaryUserId }) },
    });
    updated++;
  }
  return updated;
}

/** Categorize a batch of newly-created transactions in place (used by sync). */
export async function categorizeNewTransactions(transactionIds: string[]): Promise<number> {
  if (transactionIds.length === 0) return 0;
  const txns = await prisma.transaction.findMany({
    where: { id: { in: transactionIds } },
    select: { id: true, accountId: true, payee: true, description: true, amount: true, beneficiary: true },
  });
  const ruleUpdates = await applyRules(txns);
  const beneficiaryFills = await fillDefaultBeneficiaries(transactionIds);
  return ruleUpdates + beneficiaryFills;
}

/** Re-apply current rules to existing transactions. onlyUncategorized limits it to gaps. */
export async function recategorizeAll(onlyUncategorized: boolean): Promise<number> {
  const txns = await prisma.transaction.findMany({
    where: onlyUncategorized ? { categoryId: null } : {},
    select: { id: true, accountId: true, payee: true, description: true, amount: true, beneficiary: true },
  });
  const ruleUpdates = await applyRules(txns);
  // Unscoped on purpose, even in onlyUncategorized mode — catches historical
  // gaps regardless of when/how a transaction got its category.
  const beneficiaryFills = await fillDefaultBeneficiaries();
  return ruleUpdates + beneficiaryFills;
}
