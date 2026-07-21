import type { Account, Institution, Prisma, Transaction } from "@prisma/client";
import {
  isLiability,
  type AccountDTO,
  type AccountType,
  type Beneficiary,
  type TransactionDTO,
} from "@panditas/shared";

const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

export function toAccountDTO(
  account: Account & { institution: Institution | null },
): AccountDTO {
  return {
    id: account.id,
    name: account.name,
    label: account.label,
    displayName: account.label ?? account.name,
    type: account.type as AccountType,
    institutionName: account.institution?.name ?? null,
    currency: account.currency,
    currentBalance: Number(account.currentBalance),
    availableBalance: num(account.availableBalance),
    creditLimit: num(account.creditLimit),
    isManual: account.isManual,
    isLiability: isLiability(account.type as AccountType),
    isTracked: account.isTracked,
    ownerUserId: account.ownerUserId,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
  };
}

export function toTransactionDTO(
  txn: Transaction & {
    account: { name: string; label: string | null };
    category: { name: string } | null;
    beneficiaryUser?: { name: string } | null;
    transferAccount?: { name: string; label: string | null } | null;
  },
): TransactionDTO {
  return {
    id: txn.id,
    accountId: txn.accountId,
    accountName: txn.account.label ?? txn.account.name,
    postedAt: txn.postedAt.toISOString(),
    amount: Number(txn.amount),
    payee: txn.payee,
    description: txn.description,
    pending: txn.pending,
    categoryId: txn.categoryId,
    categoryName: txn.category?.name ?? null,
    beneficiary: (txn.beneficiary as Beneficiary | null) ?? null,
    beneficiaryUserId: txn.beneficiaryUserId,
    beneficiaryName: txn.beneficiaryUser?.name ?? null,
    beneficiaryNote: txn.beneficiaryNote,
    transferAccountId: txn.transferAccountId,
    transferAccountName: txn.transferAccount ? (txn.transferAccount.label ?? txn.transferAccount.name) : null,
  };
}
