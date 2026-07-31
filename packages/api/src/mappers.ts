import type { Account, Institution, PendingImport, Prisma, Transaction, TransactionAnomaly, TxnSource as PrismaTxnSource } from "@prisma/client";
import {
  isLiability,
  type AccountDTO,
  type AccountType,
  type AnomalyStatus,
  type AnomalyTransactionSummary,
  type Beneficiary,
  type FolderSyncFileType,
  type FolderSyncMappingSource,
  type FolderSyncStatus,
  type PendingImportSummary,
  type TransactionAnomalyDTO,
  type TransactionDTO,
} from "@panditas/shared";

const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

export function toAccountDTO(
  account: Account & {
    institution: Institution | null;
    mergedInto?: { name: string; label: string | null } | null;
  },
  // Signed sum of this account's still-pending transactions (positive = money
  // in, negative = money out — same convention as Transaction.amount).
  // Reported balance often lags pending activity by a day or two, and banks
  // differ on when they fold it in — this lets the UI show both numbers
  // instead of silently trusting one. Omitted callers (dashboard/piggybank,
  // which don't display it) get 0, i.e. reported === estimated.
  pendingTotal = 0,
): AccountDTO {
  return {
    id: account.id,
    name: account.name,
    label: account.label,
    displayName: account.label ?? account.name,
    type: account.type as AccountType,
    institutionId: account.institutionId,
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
    createdAt: account.createdAt.toISOString(),
    isNew: !account.newAcknowledgedAt,
    mergedIntoId: account.mergedIntoId,
    mergedIntoName: account.mergedInto ? (account.mergedInto.label ?? account.mergedInto.name) : null,
    pendingTotal,
    estimatedBalance: Number(account.currentBalance) + pendingTotal,
    statementDay: account.statementDay,
    dueDay: account.dueDay,
    suppressTransactionSync: account.suppressTransactionSync,
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
    source: txn.source,
    rawPayload: txn.rawPayload,
    categoryId: txn.categoryId,
    categoryName: txn.category?.name ?? null,
    beneficiary: (txn.beneficiary as Beneficiary | null) ?? null,
    beneficiaryUserId: txn.beneficiaryUserId,
    beneficiaryName: txn.beneficiaryUser?.name ?? null,
    beneficiaryNote: txn.beneficiaryNote,
    transferAccountId: txn.transferAccountId,
    transferAccountName: txn.transferAccount ? (txn.transferAccount.label ?? txn.transferAccount.name) : null,
    billStatus: txn.billStatus,
  };
}

export function toPendingImportSummaryDTO(
  pending: PendingImport & { account?: { name: string; label: string | null } | null },
): PendingImportSummary {
  return {
    id: pending.id,
    fileName: pending.fileName,
    fileType: pending.fileType as FolderSyncFileType,
    status: pending.status as FolderSyncStatus,
    mappingSource: pending.mappingSource as FolderSyncMappingSource,
    accountId: pending.accountId,
    accountLabel: pending.account ? (pending.account.label ?? pending.account.name) : null,
    confidence: pending.confidence,
    notes: pending.notes,
    errorMessage: pending.errorMessage,
    rowCount: Array.isArray(pending.rows) ? pending.rows.length : 0,
    createdAt: pending.createdAt.toISOString(),
    reviewedAt: pending.reviewedAt?.toISOString() ?? null,
  };
}

type AnomalyTxnRow = {
  id: string;
  accountId: string;
  postedAt: Date;
  amount: Prisma.Decimal;
  payee: string | null;
  source: PrismaTxnSource;
  deletedAt: Date | null;
  account: { name: string; label: string | null };
};

export function toTransactionAnomalyDTO(
  anomaly: TransactionAnomaly & { reviewedByUser?: { name: string } | null },
  txnById: Map<string, AnomalyTxnRow>,
): TransactionAnomalyDTO {
  const transactions: AnomalyTransactionSummary[] = anomaly.transactionIds
    .map((id) => txnById.get(id))
    .filter((t): t is AnomalyTxnRow => !!t)
    .map((t) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: t.account.label ?? t.account.name,
      postedAt: t.postedAt.toISOString(),
      amount: Number(t.amount),
      payee: t.payee,
      source: t.source,
      deletedAt: t.deletedAt?.toISOString() ?? null,
    }));

  return {
    id: anomaly.id,
    kind: anomaly.kind,
    detail: anomaly.detail,
    status: anomaly.status as AnomalyStatus,
    detectedAt: anomaly.detectedAt.toISOString(),
    reviewedAt: anomaly.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: anomaly.reviewedByUserId,
    reviewedByName: anomaly.reviewedByUser?.name ?? null,
    resolutionNote: anomaly.resolutionNote,
    transactions,
  };
}
