import { z } from "zod";

// ----------------------------------------------------------------------------
// Enumerations (kept in sync with prisma/schema.prisma)
// ----------------------------------------------------------------------------

export const ROLES = ["admin", "adult", "kid"] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_TYPES = [
  "chequing",
  "savings",
  "credit_card",
  "investment",
  "loan",
  "cash",
  "piggy_bank",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const VISIBILITIES = ["shared", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const BENEFICIARIES = ["self", "family_member", "household", "external"] as const;
export type Beneficiary = (typeof BENEFICIARIES)[number];

export const BENEFICIARY_LABELS: Record<Beneficiary, string> = {
  self: "Self",
  family_member: "Family member",
  household: "Whole family",
  external: "External (gift, etc.)",
};

// Which account types count as liabilities (owed) vs assets (owned).
export const LIABILITY_TYPES: AccountType[] = ["credit_card", "loan"];
export const isLiability = (t: AccountType) => LIABILITY_TYPES.includes(t);

// SimpleFIN Bridge's own dashboard, where broken institution connections are
// actually re-authenticated (this app can only detect and notify — the
// bank-login/2FA step itself happens on SimpleFIN's side).
export const SIMPLEFIN_BRIDGE_URL = "https://beta-bridge.simplefin.org/";

// Single source of truth for the app's display name, so web (nav/title) and
// api (email subjects) fall back to the same default when unconfigured.
export const DEFAULT_APP_NAME = "Panditas Wallet";

// ----------------------------------------------------------------------------
// Auth
// ----------------------------------------------------------------------------

// Unified login: identifier is a name or email (case-insensitive); secret is a
// password (adults/admin) or a PIN (kids).
export const loginSchema = z.object({
  identifier: z.string().min(1),
  secret: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ----------------------------------------------------------------------------
// User management (admin only)
// ----------------------------------------------------------------------------

export const createUserSchema = z.object({
  name: z.string().min(1),
  role: z.enum(ROLES),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  pin: z.string().min(4).max(8).optional(),
  avatarEmoji: z.string().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

// Minimal roster entry (no email/active-status) — safe for admin+adult use,
// e.g. tagging "who a transaction was for" or assigning account ownership.
export interface FamilyMemberDTO {
  id: string;
  name: string;
  role: Role;
  avatarEmoji: string | null;
}

// ----------------------------------------------------------------------------
// Accounts
// ----------------------------------------------------------------------------

export const createManualAccountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES),
  currentBalance: z.number().default(0),
  currency: z.string().default("CAD"),
  ownerUserId: z.string().optional(),
});
export type CreateManualAccountInput = z.infer<typeof createManualAccountSchema>;

export const updateBalanceSchema = z.object({
  currentBalance: z.number(),
});
export type UpdateBalanceInput = z.infer<typeof updateBalanceSchema>;

// SimpleFIN connection setup — admin pastes the Bridge access URL/token.
export const connectSimplefinSchema = z.object({
  accessUrl: z.string().url(),
});
export type ConnectSimplefinInput = z.infer<typeof connectSimplefinSchema>;

// ----------------------------------------------------------------------------
// Response DTOs
// ----------------------------------------------------------------------------

export interface AccountDTO {
  id: string;
  name: string;
  label: string | null;
  displayName: string; // label ?? name
  type: AccountType;
  institutionId: string | null;
  institutionName: string | null;
  currency: string;
  currentBalance: number;
  availableBalance: number | null;
  creditLimit: number | null;
  isManual: boolean;
  isLiability: boolean;
  isTracked: boolean;
  ownerUserId: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  // True until the user acknowledges a freshly-discovered account (e.g. from
  // a SimpleFIN reconnect) — a deliberate, persisted acknowledgment, not a
  // self-expiring "created recently" window.
  isNew: boolean;
  // Set once this account has been merged into another (same real-world
  // account, e.g. after a SimpleFIN reconnect produced a duplicate). A merged
  // account is automatically untracked; its history is retained and folded
  // into the target account's filters/balance-history, not deleted.
  mergedIntoId: string | null;
  mergedIntoName: string | null;
  // Signed sum of still-pending transactions on this account (0 when there
  // are none, or when the caller didn't compute it — see toAccountDTO).
  pendingTotal: number;
  // currentBalance adjusted by pendingTotal — an estimate, not authoritative;
  // institutions differ on whether currentBalance already reflects pending
  // activity, so this is offered alongside the reported number, not instead of it.
  estimatedBalance: number;
  // Manual, approximate bill-cycle config (credit_card accounts only).
  // Day-of-month, 1-31; SimpleFIN doesn't provide these.
  statementDay: number | null;
  dueDay: number | null;
  // When true, sync still updates this account's balance but skips ingesting
  // its transaction feed — for a feed that keeps duplicating another
  // account's activity under this one (see Account.suppressTransactionSync).
  suppressTransactionSync: boolean;
}

export interface TransactionDTO {
  id: string;
  accountId: string;
  accountName: string;
  postedAt: string;
  amount: number;
  payee: string | null;
  description: string | null;
  pending: boolean;
  categoryId: string | null;
  categoryName: string | null;
  beneficiary: Beneficiary | null;
  beneficiaryUserId: string | null;
  beneficiaryName: string | null;
  beneficiaryNote: string | null;
  // For transfer-kind transactions: the other account involved.
  transferAccountId: string | null;
  transferAccountName: string | null;
}

// A suggested (not yet applied) transfer pairing with another transaction —
// same magnitude, opposite sign, found in a different account. The user must
// explicitly apply it; nothing here is ever auto-filled.
export interface TransferSuggestionDTO {
  candidateTransactionId: string;
  accountId: string;
  accountName: string;
  confidence: number; // 0-100, based on how close the two dates are
}

export interface TransactionRowDTO extends TransactionDTO {
  transferSuggestion?: TransferSuggestionDTO | null;
}

export interface TransactionListResponse {
  items: TransactionRowDTO[];
  total: number;
}

export const tagTransactionSchema = z.object({
  categoryId: z.string().nullable().optional(),
  beneficiary: z.enum(BENEFICIARIES).nullable().optional(),
  beneficiaryUserId: z.string().nullable().optional(),
  beneficiaryNote: z.string().max(200).nullable().optional(),
  transferAccountId: z.string().nullable().optional(),
});
export type TagTransactionInput = z.infer<typeof tagTransactionSchema>;

export const linkTransferSchema = z.object({
  counterpartTransactionId: z.string().min(1),
});
export type LinkTransferInput = z.infer<typeof linkTransferSchema>;

// For recording something the bank feed won't capture (cash, a bank's
// reporting gap, backfilling before SimpleFIN was connected). Works on any
// account, not just fully-manual ones. Amount is signed: positive = money
// in, negative = money out — same convention as the rest of the ledger.
export const createManualTransactionSchema = z.object({
  accountId: z.string().min(1),
  postedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "postedAt must be YYYY-MM-DD"),
  amount: z.number().refine((n) => n !== 0, "amount must not be 0"),
  payee: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  categoryId: z.string().optional(),
});
export type CreateManualTransactionInput = z.infer<typeof createManualTransactionSchema>;

// ----------------------------------------------------------------------------
// Bulk transaction import (CSV from a bank export)
// ----------------------------------------------------------------------------
// File parsing and column mapping happen entirely client-side (institutions'
// exports vary too much — date format, one signed Amount column vs. separate
// Debit/Credit — to standardize server-side). The server only ever sees
// already-normalized rows: flag likely duplicates against existing data, then
// commit. One account per import, matching how a bank export actually works.

const importRowSchema = z.object({
  postedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "postedAt must be YYYY-MM-DD"),
  amount: z.number().refine((n) => n !== 0, "amount must not be 0"),
  payee: z.string().max(200).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
});

export const importPreviewSchema = z.object({
  accountId: z.string().min(1),
  rows: z.array(importRowSchema).min(1).max(2000),
});
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;

export interface ImportPreviewRow {
  index: number;
  postedAt: string;
  amount: number;
  payee: string | null;
  memo: string | null;
  // Best-effort match against an existing transaction on the same account —
  // same date + same amount. Not exact dedup (no externalId to match on for
  // imported rows), just a strong hint for the user to review before commit.
  duplicate: boolean;
}
export interface ImportPreviewResponse {
  rows: ImportPreviewRow[];
  duplicateCount: number;
}

export const importCommitSchema = z.object({
  accountId: z.string().min(1),
  rows: z.array(importRowSchema).min(1).max(2000),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
export interface ImportCommitResponse {
  imported: number;
  recategorized: number;
}

export interface NetWorthSummary {
  currency: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  asOf: string;
}

export interface DashboardSummary {
  netWorth: NetWorthSummary;
  creditCards: AccountDTO[];
  recentTransactions: TransactionDTO[];
  accountsByType: Record<AccountType, AccountDTO[]>;
  // When the last full SimpleFIN sync run (cron or manual) finished — shown
  // near "Sync now" so it's obvious whether re-syncing is worth it (avoids
  // burning SimpleFIN calls needlessly) and gives a future auto-sync cron a
  // visible "last ran at" signal.
  lastSyncFinishedAt: string | null;
  staleInstitutions: {
    id: string;
    name: string;
    status: string;
    statusMessage: string | null;
    lastSyncedAt: string | null;
  }[];
  newAccounts: { id: string; name: string; institutionName: string }[];
  newInstitutions: { id: string; name: string }[];
  // Still tracked, but its institution synced fine while this account wasn't
  // touched — a strong signal it may be a duplicate needing a merge (the
  // mirror image of a "new account" appearing under the same institution).
  orphanedAccounts: { id: string; name: string; institutionId: string }[];
  // Populated only when the swing since the previous sync run exceeds the
  // alert threshold (currently 10%) — null otherwise, so the frontend can
  // just check truthiness rather than re-deriving the threshold itself.
  netWorthSwing: { assetsPctChange: number | null; liabilitiesPctChange: number | null } | null;
  // Tracked credit cards with a due date in the next 14 days, soonest first.
  // Same source/estimate logic as the weekly email's "bills due" section.
  upcomingBills: UpcomingBillDTO[];
}

export interface UpcomingBillDTO {
  accountId: string;
  name: string;
  dueDate: string;
  // Naive average of the last 3 statement cycles' charges — null when there's no charge history yet.
  estimate: number | null;
  currency: string;
}

// ----------------------------------------------------------------------------
// Categories, rules & budgets (Phase 2)
// ----------------------------------------------------------------------------

export const CATEGORY_KINDS = ["income", "expense", "transfer"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
};

export const RULE_CONDITION_TYPES = ["account", "payee_contains", "description_regex", "amount_range"] as const;
export type RuleConditionType = (typeof RULE_CONDITION_TYPES)[number];

export const RULE_LOGICS = ["all", "any"] as const;
export type RuleLogic = (typeof RULE_LOGICS)[number];

export interface CategoryDTO {
  id: string;
  name: string;
  group: string | null;
  kind: CategoryKind;
  monthlyLimit: number | null;
  color: string | null;
  sortOrder: number;
  archived: boolean;
  // Applied to a transaction when a rule assigns this category — but only if
  // the transaction doesn't already have a beneficiary. Never overwrites a
  // manual tag. A specific rule can still override this via its own
  // beneficiary fields (see CategoryRuleDTO).
  defaultBeneficiary: Beneficiary | null;
  defaultBeneficiaryUserId: string | null;
  defaultBeneficiaryName: string | null;
}

export const createCategorySchema = z.object({
  name: z.string().min(1).max(60),
  group: z.string().max(60).optional(),
  kind: z.enum(CATEGORY_KINDS).default("expense"),
  monthlyLimit: z.number().nonnegative().nullable().optional(),
  color: z.string().max(20).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(60).optional(),
  group: z.string().max(60).nullable().optional(),
  monthlyLimit: z.number().nonnegative().nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  archived: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  defaultBeneficiary: z.enum(BENEFICIARIES).nullable().optional(),
  defaultBeneficiaryUserId: z.string().nullable().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export interface RuleConditionDTO {
  id: string;
  type: RuleConditionType;
  matchAccountId: string | null;
  matchAccountName: string | null;
  pattern: string | null;
  minAmount: number | null;
  maxAmount: number | null;
}

export interface CategoryRuleDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  logic: RuleLogic;
  conditions: RuleConditionDTO[];
  priority: number;
  // When set, matching transactions get their transfer account auto-filled.
  linkedAccountId: string | null;
  linkedAccountName: string | null;
  // Overrides the category's defaultBeneficiary for transactions this rule matches.
  beneficiary: Beneficiary | null;
  beneficiaryUserId: string | null;
  beneficiaryName: string | null;
}

const ruleConditionInputSchema = z
  .object({
    type: z.enum(RULE_CONDITION_TYPES),
    matchAccountId: z.string().nullable().optional(),
    pattern: z.string().max(200).nullable().optional(),
    minAmount: z.number().nonnegative().nullable().optional(),
    maxAmount: z.number().nonnegative().nullable().optional(),
  })
  .refine(
    (c) =>
      c.type === "account"
        ? !!c.matchAccountId
        : c.type === "amount_range"
          ? c.minAmount != null || c.maxAmount != null
          : !!c.pattern,
    { message: "Condition is missing its required field for its type (account/amount_range/pattern)" },
  );

export const createCategoryRuleSchema = z.object({
  categoryId: z.string().min(1),
  logic: z.enum(RULE_LOGICS).default("all"),
  conditions: z.array(ruleConditionInputSchema).min(1).max(10),
  priority: z.number().int().default(0),
  linkedAccountId: z.string().nullable().optional(),
  beneficiary: z.enum(BENEFICIARIES).nullable().optional(),
  beneficiaryUserId: z.string().nullable().optional(),
});
export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleSchema>;

export const updateCategoryRuleSchema = z.object({
  logic: z.enum(RULE_LOGICS).optional(),
  conditions: z.array(ruleConditionInputSchema).min(1).max(10).optional(),
  linkedAccountId: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  beneficiary: z.enum(BENEFICIARIES).nullable().optional(),
  beneficiaryUserId: z.string().nullable().optional(),
});
export type UpdateCategoryRuleInput = z.infer<typeof updateCategoryRuleSchema>;

export interface BudgetLineDTO {
  categoryId: string;
  categoryName: string;
  group: string | null;
  kind: CategoryKind;
  limit: number | null;
  isDefaultLimit: boolean; // true if no month-specific override exists
  spent: number; // positive number = amount spent this month
}

export const setBudgetSchema = z.object({
  categoryId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "month must be YYYY-MM-01"),
  limit: z.number().nonnegative(),
});
export type SetBudgetInput = z.infer<typeof setBudgetSchema>;

export interface SpendingBreakdownEntry {
  key: string;
  label: string;
  total: number; // positive
}

export interface SpendingBreakdown {
  month: string;
  byOwner: SpendingBreakdownEntry[];
  byBeneficiary: SpendingBreakdownEntry[];
}

// Daily income/expense totals for the dashboard's calendar heatmap and trend
// chart. `expense` is a positive magnitude; transfer-kind transactions are
// excluded (same convention as SpendingBreakdown).
export interface DailyFlowPoint {
  date: string; // YYYY-MM-DD
  income: number;
  expense: number;
}

// ----------------------------------------------------------------------------
// Piggy bank (kids)
// ----------------------------------------------------------------------------

export const addPiggyTxnSchema = z.object({
  direction: z.enum(["in", "out"]),
  amount: z.number().positive().max(1_000_000),
  description: z.string().min(1).max(100),
});
export type AddPiggyTxnInput = z.infer<typeof addPiggyTxnSchema>;

export interface PiggyPoint {
  date: string;
  balance: number;
}

export interface PiggyBankData {
  account: AccountDTO;
  transactions: TransactionDTO[];
  history: PiggyPoint[];
}

// A single account's balance-over-time series (from BalanceSnapshot, captured
// on every sync and manual balance edit) — used to drill down from the
// Dashboard's Assets/Liabilities composition donuts to one account's history.
export interface AccountBalancePoint {
  date: string;
  balance: number;
}

// ----------------------------------------------------------------------------
// Money helpers
// ----------------------------------------------------------------------------

export function formatMoney(amount: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amount);
}
