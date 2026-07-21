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
  staleInstitutions: { id: string; name: string; status: string; lastSyncedAt: string | null }[];
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

export const RULE_MATCH_TYPES = ["account", "payee_contains", "description_regex"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export interface CategoryDTO {
  id: string;
  name: string;
  group: string | null;
  kind: CategoryKind;
  monthlyLimit: number | null;
  color: string | null;
  sortOrder: number;
  archived: boolean;
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
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export interface CategoryRuleDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  matchType: RuleMatchType;
  matchAccountId: string | null;
  matchAccountName: string | null;
  pattern: string | null;
  priority: number;
  // When set, matching transactions get their transfer account auto-filled.
  linkedAccountId: string | null;
  linkedAccountName: string | null;
}

export const createCategoryRuleSchema = z
  .object({
    categoryId: z.string().min(1),
    matchType: z.enum(RULE_MATCH_TYPES),
    matchAccountId: z.string().nullable().optional(),
    pattern: z.string().max(200).nullable().optional(),
    priority: z.number().int().default(0),
    linkedAccountId: z.string().nullable().optional(),
  })
  .refine((r) => (r.matchType === "account" ? !!r.matchAccountId : !!r.pattern), {
    message: "Account rules need matchAccountId; text rules need a pattern",
  });
export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleSchema>;

export const updateCategoryRuleSchema = z.object({
  linkedAccountId: z.string().nullable().optional(),
  priority: z.number().int().optional(),
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

// ----------------------------------------------------------------------------
// Money helpers
// ----------------------------------------------------------------------------

export function formatMoney(amount: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amount);
}
