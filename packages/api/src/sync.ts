import type { AccountType } from "@panditas/shared";
import { prisma } from "./db.js";
import { categorizeNewTransactions } from "./categorize.js";
import { decrypt } from "./crypto.js";
import {
  classifySimplefinError,
  fetchAccounts,
  isAdvisoryError,
  parseLegacyInstitutionError,
  type NormalizedAccount,
  type NormalizedError,
} from "./simplefin.js";
import { notifyConnectionBroken, notifyInstitutionBroken } from "./notifications.js";
import { computeTrackedNetWorthTotals } from "./netWorth.js";
import { createOneTimeNotification, syncLiveConditionNotifications } from "./notificationCenter.js";

// A fresh Prisma write sets createdAt and updatedAt to the same instant —
// the cheapest reliable way to tell "just created" from "existing row
// updated" out of an upsert without restructuring every call site into
// separate find/create/update branches.
function wasJustCreated(row: { createdAt: Date; updatedAt: Date }): boolean {
  return row.createdAt.getTime() === row.updatedAt.getTime();
}

type BrokenStatus = "auth_required" | "error";
interface InstitutionSnapshot {
  name: string;
  status: string;
  statusMessage: string | null;
}

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

async function upsertAccount(institutionId: string, institutionName: string, a: NormalizedAccount): Promise<{ accountId: string; added: number }> {
  const existingAccount = await prisma.account.findUnique({
    where: { institutionId_externalId: { institutionId, externalId: a.externalId } },
  });

  // A flaky connector can serve a stale cached response — an older
  // balance-date than what we already have on file for this account
  // (observed: Questrade, months-old balance replayed on most syncs). Taking
  // it at face value would silently regress currentBalance, and net worth
  // with it, back to out-of-date data. Skip the balance/snapshot write when
  // that happens; everything else about this sync still runs normally.
  // A missing balance-date on the incoming payload counts as stale too, not
  // as "fresh by default" — once we have a trusted balanceAsOf on file, an
  // undated reply is more likely a degraded/cached response (observed right
  // as a connector slides into auth_required) than genuinely new data.
  const isStaleBalance =
    !!existingAccount?.balanceAsOf && (!a.balanceDate || a.balanceDate < existingAccount.balanceAsOf);

  if (!isStaleBalance && existingAccount && Number(a.balance) < Number(existingAccount.currentBalance)) {
    console.warn(
      `[sync] balance decrease accepted for account ${existingAccount.id} (${a.name}): ` +
        `${existingAccount.currentBalance} -> ${a.balance}, balanceDate ${a.balanceDate?.toISOString() ?? "null"} ` +
        `(existing balanceAsOf ${existingAccount.balanceAsOf?.toISOString() ?? "null"})`,
    );
  }

  const account = existingAccount
    ? await prisma.account.update({
        where: { id: existingAccount.id },
        // On update, do NOT overwrite user-edited name/type.
        data: isStaleBalance
          ? { lastSyncedAt: new Date() }
          : {
              currency: a.currency,
              currentBalance: a.balance,
              availableBalance: a.availableBalance,
              balanceAsOf: a.balanceDate,
              lastSyncedAt: new Date(),
            },
      })
    : await prisma.account.create({
        data: {
          institutionId,
          externalId: a.externalId,
          name: a.name,
          type: guessAccountType(a.orgName, a.name),
          currency: a.currency,
          currentBalance: a.balance,
          availableBalance: a.availableBalance,
          balanceAsOf: a.balanceDate,
          isManual: false,
          lastSyncedAt: new Date(),
        },
      });

  if (wasJustCreated(account)) {
    await createOneTimeNotification("new_account", account.id, account.name, institutionName);
  }

  if (!isStaleBalance) {
    await prisma.balanceSnapshot.create({
      data: { accountId: account.id, balance: a.balance, capturedAt: a.balanceDate ?? new Date() },
    });
  }

  // Balance/snapshot above stays authoritative either way — this only skips
  // ingesting this account's transaction feed (see schema comment on
  // suppressTransactionSync for why an account would need this).
  if (account.suppressTransactionSync) {
    return { accountId: account.id, added: 0 };
  }

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
    await reassignMisroutedRrspContributions(account.id, newTxnIds);
    await categorizeNewTransactions(newTxnIds);
  }

  return { accountId: account.id, added: toCreate.length };
}

// Sun Life's SimpleFIN feed lumps TFSA and RRSP contribution transactions
// together under whichever of the two accounts it resolves first (observed:
// always the TFSA). RRSP-bound rows are identifiable by fund name regardless
// of which account they land in, so any landing on a "TFSA"-labeled Sun Life
// account get moved to the sibling "RRSP" account at the same institution
// before categorization runs. No-ops for every other institution/account.
// Regexes, not literal substrings — Sun Life inconsistently inserts a fund
// code into the name (e.g. "Retirement X Units at Contribution Member" vs.
// "Retirement Units at Contribution Member"), which a literal match misses.
const RRSP_FUND_PAYEE_PATTERNS = [/Employer Contribution/i, /Retirement.*Units at Contribution Member/i];

async function reassignMisroutedRrspContributions(accountId: string, newTxnIds: string[]): Promise<void> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { institution: true },
  });
  if (!account) return;
  const isSunlifeTfsa =
    /sun\s*life/i.test(account.institution?.name ?? "") && /tfsa/i.test(account.label ?? account.name);
  if (!isSunlifeTfsa) return;

  const rrspSibling = await prisma.account.findFirst({
    where: {
      institutionId: account.institutionId,
      id: { not: account.id },
      OR: [{ label: { contains: "RRSP", mode: "insensitive" } }, { name: { contains: "RRSP", mode: "insensitive" } }],
    },
  });
  if (!rrspSibling) return;

  const newTxns = await prisma.transaction.findMany({
    where: { id: { in: newTxnIds } },
    select: { id: true, externalId: true, payee: true },
  });
  const candidates = newTxns.filter((t) => t.payee && RRSP_FUND_PAYEE_PATTERNS.some((p) => p.test(t.payee!)));
  if (candidates.length === 0) return;

  // The feed re-delivers these under the TFSA account on every sync, even
  // after we've already relocated the original copy — so the RRSP sibling
  // may already hold a row with this externalId. (accountId, externalId) is
  // unique, so blindly moving a fresh duplicate into RRSP would throw and
  // silently abort the rest of the sync. Delete the redundant new copy
  // instead of moving it whenever that's the case.
  const candidateExternalIds = candidates.map((c) => c.externalId).filter((id): id is string => !!id);
  const alreadyInRrsp = new Set(
    (
      await prisma.transaction.findMany({
        where: { accountId: rrspSibling.id, externalId: { in: candidateExternalIds } },
        select: { externalId: true },
      })
    ).map((t) => t.externalId),
  );

  const toDelete = candidates.filter((c) => c.externalId && alreadyInRrsp.has(c.externalId));
  const toMove = candidates.filter((c) => !(c.externalId && alreadyInRrsp.has(c.externalId)));

  if (toDelete.length > 0) {
    await prisma.transaction.deleteMany({ where: { id: { in: toDelete.map((c) => c.id) } } });
  }
  if (toMove.length > 0) {
    await prisma.transaction.updateMany({ where: { id: { in: toMove.map((c) => c.id) } }, data: { accountId: rrspSibling.id } });
  }
}

// A bank domain can host multiple separate underlying connections — one per
// family member's own login to the same institution (e.g. "TD Canada Trust
// (Sandeep)" and "TD Canada Trust (Swati)") — but SimpleFIN groups all their
// accounts into a single org/Institution row keyed by domain. Strip the
// trailing "(Name)" qualifier so a legacy error naming either spouse's
// connection still matches that one shared institution row instead of
// spawning a phantom zero-account duplicate.
function normalizeInstitutionName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

/** Fire a broken-institution email, but only for a genuine ok/never_synced ->
 * broken transition, never on repeat syncs of an already-known-broken one. */
function notifyIfNewlyBroken(before: InstitutionSnapshot | undefined, after: InstitutionSnapshot) {
  const wasOk = !before || before.status === "ok" || before.status === "never_synced";
  const isBroken = after.status === "auth_required" || after.status === "error";
  if (wasOk && isBroken) {
    notifyInstitutionBroken({
      name: after.name,
      status: after.status as BrokenStatus,
      statusMessage: after.statusMessage,
    }).catch((err) => console.error("[notifications] institution-broken email failed:", err));
  }
}

/** Sync a single SimpleFIN connection. */
export async function syncConnection(connectionId: string): Promise<SyncSummary> {
  const connection = await prisma.simplefinConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new Error("Connection not found");
  const prevConnectionStatus = connection.status;

  const run = await prisma.syncRun.create({ data: { status: "running" } });
  const summary: SyncSummary = {
    connectionsSynced: 0,
    accountsUpdated: 0,
    transactionsAdded: 0,
    errors: [],
  };

  try {
    const accessUrl = decrypt(connection.accessUrlEncrypted);
    const { accounts, errors: rawErrors, errlist: rawErrlist, connections: rawConnections } =
      await fetchAccounts(accessUrl);
    // SimpleFIN returns benign date-range advisories in the same array as real
    // errors (auth required, etc.). Filter advisories so health stays accurate.
    const errors = rawErrors.filter((e) => !isAdvisoryError(e));
    const errlist = rawErrlist.filter((e) => !isAdvisoryError(e.msg));

    const beforeInstitutions = await prisma.institution.findMany({
      where: { connectionId: connection.id },
      select: { id: true, name: true, status: true, statusMessage: true },
    });
    const beforeById = new Map(beforeInstitutions.map((i) => [i.id, i]));

    const connById = new Map(rawConnections.map((c) => [c.connId, c]));
    const handledConnIds = new Set<string>();

    // Primary attribution path against the real, currently-observed Bridge
    // shape: plain "Connection to {name} may need attention. {reason}"
    // strings, no conn_id at all. Parsed once, matched by (trimmed,
    // case-insensitive) institution name below.
    const legacyErrors = errors
      .map((e) => parseLegacyInstitutionError(e))
      .filter((e): e is { name: string; reason: string } => e !== null);
    const matchedLegacyNames = new Set<string>();

    // Group by institution (org) — orgs with at least one account this sync.
    const byOrg = new Map<string, { name: string; connId: string | null; accounts: NormalizedAccount[] }>();
    for (const a of accounts) {
      const entry = byOrg.get(a.orgKey) ?? { name: a.orgName, connId: a.connId, accounts: [] };
      entry.accounts.push(a);
      byOrg.set(a.orgKey, entry);
    }

    for (const [orgKey, org] of byOrg) {
      if (org.connId) handledConnIds.add(org.connId);
      // SimpleFIN often still returns an institution's (possibly cached/stale)
      // accounts on the same sync it reports that institution needs
      // attention — having accounts this sync is NOT proof of health. Check
      // both the structured errlist (by connId) and the legacy free-text
      // errors (by name) regardless of whether accounts came through.
      const orgErrlistErrors = org.connId ? errlist.filter((e) => e.connId === org.connId) : [];
      // Normalized match: the same bank domain/org can host multiple separate
      // per-family-member connections (see normalizeInstitutionName above).
      const orgNameKey = normalizeInstitutionName(org.name);
      const orgLegacyMatches = legacyErrors.filter((le) => normalizeInstitutionName(le.name) === orgNameKey);
      for (const m of orgLegacyMatches) matchedLegacyNames.add(m.name.toLowerCase());

      const status =
        orgErrlistErrors.length > 0
          ? classifySimplefinError(orgErrlistErrors[0]!)
          : orgLegacyMatches.length > 0
            ? classifySimplefinError({ msg: orgLegacyMatches[0]!.reason })
            : "ok";
      const statusMessage =
        orgErrlistErrors.length > 0
          ? orgErrlistErrors.map((e) => e.msg).join("; ")
          : orgLegacyMatches.length > 0
            ? [...new Set(orgLegacyMatches.map((m) => m.reason))].join("; ")
            : null;

      // Look up by externalId first, then by connId — an institution that was
      // previously created from an errlist-only sync (before any account ever
      // came through) may have a different best-effort externalId than the
      // real orgKey we now know; reconcile onto the same row instead of
      // creating a duplicate.
      const existing =
        (await prisma.institution.findUnique({
          where: { provider_externalId: { provider: "simplefin", externalId: orgKey } },
        })) ??
        (org.connId
          ? await prisma.institution.findFirst({ where: { provider: "simplefin", connId: org.connId } })
          : null);

      const institution = existing
        ? await prisma.institution.update({
            where: { id: existing.id },
            data: {
              name: org.name,
              externalId: orgKey,
              connId: org.connId,
              connectionId: connection.id,
              status,
              statusMessage,
              lastSyncedAt: new Date(),
            },
          })
        : await prisma.institution.create({
            data: {
              name: org.name,
              provider: "simplefin",
              externalId: orgKey,
              connId: org.connId,
              connectionId: connection.id,
              status,
              statusMessage,
              lastSyncedAt: new Date(),
            },
          });

      if (!existing) await createOneTimeNotification("new_institution", institution.id, institution.name, null);
      notifyIfNewlyBroken(beforeById.get(institution.id), institution);

      for (const a of org.accounts) {
        const { added } = await upsertAccount(institution.id, institution.name, a);
        summary.accountsUpdated += 1;
        summary.transactionsAdded += added;
      }
    }

    // Institutions with zero accounts this sync but a structured error —
    // previously a silent no-op, leaving status/lastSyncedAt untouched forever.
    const errorsByConnId = new Map<string, NormalizedError[]>();
    for (const e of errlist) {
      if (!e.connId || handledConnIds.has(e.connId)) continue;
      const arr = errorsByConnId.get(e.connId) ?? [];
      arr.push(e);
      errorsByConnId.set(e.connId, arr);
    }

    for (const [connId, errs] of errorsByConnId) {
      const conn = connById.get(connId);
      const orgKeyGuess = conn?.orgId ?? connId;
      const existing =
        (await prisma.institution.findFirst({ where: { provider: "simplefin", connId } })) ??
        (await prisma.institution.findUnique({
          where: { provider_externalId: { provider: "simplefin", externalId: orgKeyGuess } },
        }));
      const status = classifySimplefinError(errs[0]!);
      const statusMessage = errs.map((e) => e.msg).join("; ");

      const institution = existing
        ? await prisma.institution.update({
            where: { id: existing.id },
            data: { status, statusMessage, connId, connectionId: connection.id },
          })
        : await prisma.institution.create({
            data: {
              name: conn?.name ?? "Unknown institution",
              provider: "simplefin",
              externalId: orgKeyGuess,
              connId,
              connectionId: connection.id,
              status,
              statusMessage,
            },
          });

      if (!existing) await createOneTimeNotification("new_institution", institution.id, institution.name, null);
      notifyIfNewlyBroken(beforeById.get(institution.id), institution);
    }

    // Legacy-shape errors that didn't match any org with accounts this sync —
    // an institution reported broken with literally zero data returned.
    // Attribute by (normalized) name against an existing Institution row, or
    // create one. Grouped by normalized key first so e.g. both spouses'
    // messages for the same shared bank domain land on one row, not two.
    const unmatchedByKey = new Map<string, { name: string; reasons: string[] }>();
    for (const le of legacyErrors) {
      if (matchedLegacyNames.has(le.name.toLowerCase())) continue;
      const key = normalizeInstitutionName(le.name);
      const entry = unmatchedByKey.get(key) ?? { name: le.name, reasons: [] };
      entry.reasons.push(le.reason);
      unmatchedByKey.set(key, entry);
    }

    if (unmatchedByKey.size > 0) {
      const allSimplefinInstitutions = await prisma.institution.findMany({
        where: { provider: "simplefin" },
      });
      for (const [key, { name, reasons }] of unmatchedByKey) {
        const status = classifySimplefinError({ msg: reasons[0]! });
        const statusMessage = [...new Set(reasons)].join("; ");
        const existing = allSimplefinInstitutions.find((i) => normalizeInstitutionName(i.name) === key);

        const institution = existing
          ? await prisma.institution.update({
              where: { id: existing.id },
              data: { status, statusMessage, connectionId: connection.id },
            })
          : await prisma.institution.create({
              data: {
                name,
                provider: "simplefin",
                externalId: key.replace(/\s+/g, "-"),
                connectionId: connection.id,
                status,
                statusMessage,
              },
            });

        if (!existing) await createOneTimeNotification("new_institution", institution.id, institution.name, null);
        notifyIfNewlyBroken(beforeById.get(institution.id), institution);
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
    if (prevConnectionStatus !== "error") {
      notifyConnectionBroken({ label: connection.label, statusMessage: message }).catch((e) =>
        console.error("[notifications] connection-broken email failed:", e),
      );
    }
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

    // One checkpoint per full sync run (household-wide, not per-connection) —
    // the baseline the Dashboard's >10% assets/liabilities swing alert diffs
    // the two most recent rows against.
    const { assets, liabilities } = await computeTrackedNetWorthTotals();
    await prisma.netWorthCheckpoint.create({ data: { assetsTotal: assets, liabilitiesTotal: liabilities } });

    // Re-check the "live condition" alert types (stale/orphaned/swing) against
    // the state this sync just produced. One-time events (new account/
    // institution) already fired inline above, at the moment of creation.
    await syncLiveConditionNotifications();
  } finally {
    syncing = false;
  }
  return total;
}
