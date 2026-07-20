import type { AccountType } from "@panditas/shared";
import { prisma } from "./db.js";
import { categorizeNewTransactions } from "./categorize.js";
import { decrypt } from "./crypto.js";
import { fetchAccounts, type NormalizedAccount } from "./simplefin.js";

export interface SyncSummary {
  connectionsSynced: number;
  accountsUpdated: number;
  transactionsAdded: number;
  errors: string[];
}

let syncing = false;

/** Best-effort account-type guess for newly discovered accounts (user can correct later). */
export function guessAccountType(orgName: string, accountName: string): AccountType {
  const s = `${orgName} ${accountName}`.toLowerCase();
  if (/(visa|mastercard|amex|credit|rewards card|aeroplan|triangle|\bcard\b)/.test(s)) {
    return "credit_card";
  }
  if (/(loan|mortgage|line of credit|\bloc\b)/.test(s)) return "loan";
  if (/(tfsa|rrsp|fhsa|resp|rrif|invest|brokerage|crypto|questrade|questedge|wealthsimple|sun ?life)/.test(s)) {
    return "investment";
  }
  if (/saving/.test(s)) return "savings";
  if (/(chequing|checking|cheque|debit)/.test(s)) return "chequing";
  return "chequing";
}

async function upsertAccount(institutionId: string, a: NormalizedAccount): Promise<{ accountId: string; added: number }> {
  const account = await prisma.account.upsert({
    where: { institutionId_externalId: { institutionId, externalId: a.externalId } },
    create: {
      institutionId,
      externalId: a.externalId,
      name: a.name,
      type: guessAccountType(a.orgName, a.name),
      currency: a.currency,
      currentBalance: a.balance,
      availableBalance: a.availableBalance,
      isManual: false,
      lastSyncedAt: new Date(),
    },
    // On update, do NOT overwrite user-edited name/type.
    update: {
      currency: a.currency,
      currentBalance: a.balance,
      availableBalance: a.availableBalance,
      lastSyncedAt: new Date(),
    },
  });

  await prisma.balanceSnapshot.create({
    data: { accountId: account.id, balance: a.balance, capturedAt: a.balanceDate ?? new Date() },
  });

  // Insert new transactions; refresh any that were pending and may now be posted.
  const existing = await prisma.transaction.findMany({
    where: { accountId: account.id, externalId: { in: a.transactions.map((t) => t.id) } },
    select: { externalId: true, pending: true },
  });
  const existingById = new Map(existing.map((t) => [t.externalId, t]));

  const toCreate = a.transactions.filter((t) => !existingById.has(t.id));
  let newTxnIds: string[] = [];
  if (toCreate.length > 0) {
    await prisma.transaction.createMany({
      data: toCreate.map((t) => ({
        accountId: account.id,
        externalId: t.id,
        postedAt: t.posted,
        amount: t.amount,
        payee: t.payee,
        description: t.description,
        memo: t.memo,
        pending: t.pending,
        source: "simplefin" as const,
      })),
      skipDuplicates: true,
    });
    // createMany doesn't return ids — look them up so they can be auto-categorized.
    const created = await prisma.transaction.findMany({
      where: { accountId: account.id, externalId: { in: toCreate.map((t) => t.id) } },
      select: { id: true },
    });
    newTxnIds = created.map((t) => t.id);
  }

  for (const t of a.transactions) {
    const prev = existingById.get(t.id);
    if (prev && prev.pending && !t.pending) {
      await prisma.transaction.update({
        where: { accountId_externalId: { accountId: account.id, externalId: t.id } },
        data: { pending: false, amount: t.amount, postedAt: t.posted },
      });
    }
  }

  if (newTxnIds.length > 0) {
    await categorizeNewTransactions(newTxnIds);
  }

  return { accountId: account.id, added: toCreate.length };
}

/** Sync a single SimpleFIN connection. */
export async function syncConnection(connectionId: string): Promise<SyncSummary> {
  const connection = await prisma.simplefinConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new Error("Connection not found");

  const run = await prisma.syncRun.create({ data: { status: "running" } });
  const summary: SyncSummary = {
    connectionsSynced: 0,
    accountsUpdated: 0,
    transactionsAdded: 0,
    errors: [],
  };

  try {
    const accessUrl = decrypt(connection.accessUrlEncrypted);
    const { accounts, errors: rawErrors } = await fetchAccounts(accessUrl);
    // SimpleFIN returns benign date-range advisories in the same array as real
    // errors (auth required, etc.). Filter advisories so health stays accurate.
    const errors = rawErrors.filter(
      (e) => !/recommended range|exceeds limit|was capped|date range/i.test(e),
    );

    // Group by institution (org).
    const byOrg = new Map<string, { name: string; accounts: NormalizedAccount[] }>();
    for (const a of accounts) {
      const entry = byOrg.get(a.orgKey) ?? { name: a.orgName, accounts: [] };
      entry.accounts.push(a);
      byOrg.set(a.orgKey, entry);
    }

    for (const [orgKey, org] of byOrg) {
      const institution = await prisma.institution.upsert({
        where: { provider_externalId: { provider: "simplefin", externalId: orgKey } },
        create: {
          name: org.name,
          provider: "simplefin",
          externalId: orgKey,
          connectionId: connection.id,
          status: "ok",
          lastSyncedAt: new Date(),
        },
        update: { name: org.name, connectionId: connection.id, status: "ok", lastSyncedAt: new Date() },
      });
      for (const a of org.accounts) {
        const { added } = await upsertAccount(institution.id, a);
        summary.accountsUpdated += 1;
        summary.transactionsAdded += added;
      }
    }

    summary.errors = errors;
    summary.connectionsSynced = 1;

    await prisma.simplefinConnection.update({
      where: { id: connection.id },
      data: {
        status: errors.length > 0 ? "partial" : "success",
        statusMessage: errors.length > 0 ? errors.join("; ") : null,
        lastSyncedAt: new Date(),
      },
    });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: errors.length > 0 ? "partial" : "success",
        message: errors.length > 0 ? errors.join("; ") : null,
        accountsUpdated: summary.accountsUpdated,
        transactionsAdded: summary.transactionsAdded,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    summary.errors.push(message);
    await prisma.simplefinConnection.update({
      where: { id: connection.id },
      data: { status: "error", statusMessage: message },
    });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "error", message, finishedAt: new Date() },
    });
  }

  return summary;
}

/** Sync every configured connection. Guarded against overlapping runs. */
export async function syncAll(): Promise<SyncSummary> {
  if (syncing) return { connectionsSynced: 0, accountsUpdated: 0, transactionsAdded: 0, errors: ["Sync already in progress"] };
  syncing = true;
  const total: SyncSummary = { connectionsSynced: 0, accountsUpdated: 0, transactionsAdded: 0, errors: [] };
  try {
    const connections = await prisma.simplefinConnection.findMany({ select: { id: true } });
    for (const c of connections) {
      const s = await syncConnection(c.id);
      total.connectionsSynced += s.connectionsSynced;
      total.accountsUpdated += s.accountsUpdated;
      total.transactionsAdded += s.transactionsAdded;
      total.errors.push(...s.errors);
    }
  } finally {
    syncing = false;
  }
  return total;
}
