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
}

export const tagTransactionSchema = z.object({
  categoryId: z.string().nullable().optional(),
  beneficiary: z.enum(BENEFICIARIES).nullable().optional(),
  beneficiaryUserId: z.string().nullable().optional(),
  beneficiaryNote: z.string().max(200).nullable().optional(),
});
export type TagTransactionInput = z.infer<typeof tagTransactionSchema>;

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
