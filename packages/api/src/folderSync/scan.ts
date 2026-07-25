import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { FolderSyncFileType, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { env } from "../env.js";
import {
  mapCsvColumns,
  resolveAmbiguousAccountGroups,
  resolveInitialStatus,
  transcribePdf,
  type AccountBrief,
  type AccountMatch,
  type AmbiguousAccountGroup,
} from "./agent.js";
import { parseCsv, type ParsedGrid } from "./csvParse.js";
import { hashFileBytes, hashHeaderRow } from "./fingerprint.js";
import { applyColumnMapping, groupRowsByAccountColumn, type AccountGroup, type ColumnMapping } from "./normalize.js";
import { parseXlsx } from "./xlsxParse.js";

export interface ScanSummary {
  scanned: number;
  staged: number;
  skipped: number;
  failed: number;
}

const EXTENSION_TYPE: Record<string, FolderSyncFileType> = {
  ".csv": "csv",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".pdf": "pdf",
};

// Recognized account-type keywords that map onto our own AccountType enum —
// used as a narrowing fallback when a candidate's name/officialName doesn't
// literally contain the file's account-type text (e.g. a "Chequing" column
// value where the account is just labeled "Cash").
const TYPE_KEYWORD_TO_ACCOUNT_TYPE: Record<string, string> = {
  chequing: "chequing",
  checking: "chequing",
  savings: "savings",
  "credit card": "credit_card",
  creditcard: "credit_card",
  loan: "loan",
};

// Manual "Scan folder" trigger only for v1 — no cron, no file-watcher.
// Dedupes rescans by file content hash, not name/mtime, so a re-dropped copy
// of an already-processed file is skipped even if it was renamed.
export async function scanFolder(): Promise<ScanSummary> {
  if (!env.FOLDER_SYNC_DIR) {
    throw new Error("FOLDER_SYNC_DIR is not configured.");
  }

  let entries;
  try {
    entries = await readdir(env.FOLDER_SYNC_DIR, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason =
      code === "ENOENT"
        ? "that path doesn't exist"
        : code === "ENOTDIR"
          ? "that path isn't a directory"
          : code === "EACCES"
            ? "the server doesn't have permission to read it"
            : "it couldn't be read";
    throw new Error(`Can't scan FOLDER_SYNC_DIR (${env.FOLDER_SYNC_DIR}) — ${reason}.`);
  }
  const files = entries.filter((e) => e.isFile() && EXTENSION_TYPE[path.extname(e.name).toLowerCase()]);

  const summary: ScanSummary = { scanned: files.length, staged: 0, skipped: 0, failed: 0 };
  if (files.length === 0) return summary;

  const accountRows = await prisma.account.findMany({
    where: { mergedIntoId: null },
    select: { id: true, name: true, officialName: true, type: true, currency: true, institution: { select: { name: true } } },
  });
  const accounts: AccountBrief[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    officialName: a.officialName,
    type: a.type,
    currency: a.currency,
    institutionName: a.institution?.name ?? null,
  }));

  const maxBytes = env.FOLDER_SYNC_MAX_FILE_MB * 1024 * 1024;

  for (const entry of files) {
    const fileType = EXTENSION_TYPE[path.extname(entry.name).toLowerCase()]!;
    const filePath = path.join(env.FOLDER_SYNC_DIR, entry.name);
    const bytes = await readFile(filePath);
    const fileHash = hashFileBytes(bytes);

    // A multi-account file can produce several PendingImport rows sharing
    // one fileHash (one per groupKey), so dedup checks every row for this
    // hash rather than a single unique lookup. Only retry when EVERY row
    // from a prior attempt failed — a partially-successful multi-account
    // split (some groups staged, one failed) is left alone rather than
    // risking duplicate rows for the groups that already worked.
    const existingRows = await prisma.pendingImport.findMany({ where: { fileHash } });
    if (existingRows.length > 0) {
      const allFailed = existingRows.every((r) => r.status === "parse_failed");
      if (!allFailed) {
        summary.skipped++;
        continue;
      }
      await prisma.pendingImport.deleteMany({ where: { fileHash } });
    }

    if (bytes.length > maxBytes) {
      await prisma.pendingImport.create({
        data: {
          fileName: entry.name,
          fileHash,
          fileType,
          status: "parse_failed",
          mappingSource: "agent",
          rows: [],
          errorMessage: `File is ${(bytes.length / 1024 / 1024).toFixed(1)} MB, over the ${env.FOLDER_SYNC_MAX_FILE_MB} MB folder sync limit.`,
        },
      });
      summary.failed++;
      continue;
    }

    try {
      if (fileType === "csv") await stageCsv(entry.name, bytes, fileHash, accounts);
      else if (fileType === "xlsx") await stageXlsx(entry.name, bytes, fileHash, accounts);
      else await stagePdf(entry.name, bytes, fileHash, accounts);
      summary.staged++;
    } catch (err) {
      // CSV keeps a fallback (the raw file stays downloadable for the manual
      // Import.tsx flow); XLSX/PDF have no such path in v1 — the review UI
      // says so plainly.
      await prisma.pendingImport.create({
        data: {
          fileName: entry.name,
          fileHash,
          fileType,
          status: "parse_failed",
          mappingSource: "agent",
          rows: [],
          errorMessage: err instanceof Error ? err.message : "Unknown error while parsing this file.",
        },
      });
      summary.failed++;
    }
  }

  return summary;
}

// Uniform shape for "however we figured out this file's structure" — either
// a cache hit (deterministic, no agent confidence to report) or a fresh
// agent call — so the row-creation logic below doesn't need to know which.
interface ResolvedFileMapping {
  columnMapping: ColumnMapping;
  // Multi-account files only: which column holds a per-row account
  // identifier (and optionally its type). Null for an ordinary file.
  accountColumn: number | null;
  accountTypeColumn: number | null;
  // Single-account files only.
  accountMatch: AccountMatch | null;
  overallConfidence: number | null;
  notes: string | null;
  // Institution guessed for the whole file (e.g. "Wealthsimple") — the hard
  // scoping filter multi-account candidate narrowing runs first, before any
  // label/type matching. Without this, a raw account-type keyword like
  // "Chequing" can collide with an unrelated institution's account whose own
  // sync-derived name happens to contain that word (seen for real: a
  // Wealthsimple chequing row incorrectly auto-matched a TD chequing account).
  institutionGuess: string | null;
  // Multi-account files only, from a prior human-taught approve: raw
  // account id -> target Account.id, resolved with no agent call at all.
  accountIdHints: Record<string, string>;
}

async function stageCsv(fileName: string, bytes: Buffer, fileHash: string, accounts: AccountBrief[]): Promise<void> {
  const grid = parseCsv(bytes);
  const headerFingerprint = hashHeaderRow(grid.header);
  const cached = await prisma.folderSyncMapping.findUnique({ where: { headerFingerprint } });

  if (cached) {
    const resolved: ResolvedFileMapping = {
      columnMapping: {
        dateColumn: cached.dateColumn,
        dateFormat: cached.dateFormat as ColumnMapping["dateFormat"],
        payeeColumn: cached.payeeColumn,
        memoColumn: cached.memoColumn,
        amountMode: cached.amountMode as ColumnMapping["amountMode"],
        amountColumn: cached.amountColumn,
        flipSign: cached.flipSign,
        debitColumn: cached.debitColumn,
        creditColumn: cached.creditColumn,
      },
      accountColumn: cached.accountColumn,
      accountTypeColumn: cached.accountTypeColumn,
      accountMatch: cached.suggestedAccountId ? { accountId: cached.suggestedAccountId, confidence: 1 } : null,
      overallConfidence: null,
      notes: null,
      institutionGuess: cached.sourceLabel,
      accountIdHints: (cached.accountIdHints as Record<string, string> | null) ?? {},
    };
    await createPendingImportRows(fileName, fileHash, "csv", grid, resolved, "cache_hit", cached.id, headerFingerprint, accounts);
    await prisma.folderSyncMapping.update({ where: { id: cached.id }, data: { lastUsedAt: new Date() } });
    return;
  }

  const result = await mapCsvColumns(grid, accounts, fileName);
  const resolved: ResolvedFileMapping = {
    columnMapping: result.columnMapping,
    accountColumn: result.accountIdentifierColumn,
    accountTypeColumn: result.accountTypeColumn,
    accountMatch: result.accountMatch,
    overallConfidence: result.overallConfidence,
    notes: result.notes,
    institutionGuess: result.institutionGuess,
    accountIdHints: {},
  };
  await createPendingImportRows(fileName, fileHash, "csv", grid, resolved, "agent", null, headerFingerprint, accounts);
}

async function stageXlsx(fileName: string, bytes: Buffer, fileHash: string, accounts: AccountBrief[]): Promise<void> {
  const grid = parseXlsx(bytes);
  const result = await mapCsvColumns(grid, accounts, fileName);
  const resolved: ResolvedFileMapping = {
    columnMapping: result.columnMapping,
    accountColumn: result.accountIdentifierColumn,
    accountTypeColumn: result.accountTypeColumn,
    accountMatch: result.accountMatch,
    overallConfidence: result.overallConfidence,
    notes: result.notes,
    institutionGuess: result.institutionGuess,
    accountIdHints: {},
  };
  const suffix = grid.hadMultipleSheets ? "This workbook has multiple sheets — only the first was read." : undefined;
  // No mapping cache for XLSX in v1 — always agent, headerFingerprint null.
  await createPendingImportRows(fileName, fileHash, "xlsx", grid, resolved, "agent", null, null, accounts, suffix);
}

async function stagePdf(fileName: string, bytes: Buffer, fileHash: string, accounts: AccountBrief[]): Promise<void> {
  const result = await transcribePdf(bytes, accounts);
  await prisma.pendingImport.create({
    data: {
      fileName,
      fileHash,
      fileType: "pdf",
      status: resolveInitialStatus(result.accountMatch, result.overallConfidence),
      mappingSource: "agent",
      accountId: result.accountMatch?.accountId ?? null,
      confidence: result.overallConfidence,
      rows: result.rows,
      notes: result.notes,
    },
  });
}

// Filters the household account list down to plausible candidates for one
// raw account group. Institution scoping runs FIRST and is a hard filter,
// not a preference — without it, a generic type keyword like "Chequing" can
// literally appear in an unrelated institution's own sync-derived account
// name (seen for real: a Wealthsimple chequing row matched a TD chequing
// account, because TD's raw name happened to contain the word "CHEQUING"
// and Wealthsimple's own account name didn't contain it at all). Only when
// institutionGuess itself is unknown do we fall back to the full household
// list, since at that point any signal beats none.
//
// Within the (now institution-scoped) set, narrow further by whether the
// account-type text literally appears in the account's name/officialName
// (works for registered-account labels like "...TFSA", "...FHSA", "...RESP"),
// falling back to an exact AccountType match for generic bank-account terms.
function narrowCandidates(accounts: AccountBrief[], accountType: string | null, institutionGuess: string | null): AccountBrief[] {
  let pool = accounts;
  if (institutionGuess) {
    const institutionKeyword = institutionGuess.trim().toLowerCase();
    if (institutionKeyword) {
      pool = accounts.filter((a) => {
        const known = a.institutionName?.toLowerCase();
        return known ? known.includes(institutionKeyword) || institutionKeyword.includes(known) : false;
      });
    }
  }

  if (!accountType) return pool;
  const keyword = accountType.trim().toLowerCase();
  if (!keyword) return pool;
  const byLabel = pool.filter(
    (a) => a.name.toLowerCase().includes(keyword) || (a.officialName?.toLowerCase().includes(keyword) ?? false),
  );
  if (byLabel.length > 0) return byLabel;
  const mappedType = TYPE_KEYWORD_TO_ACCOUNT_TYPE[keyword];
  if (mappedType) {
    const byType = pool.filter((a) => a.type === mappedType);
    if (byType.length > 0) return byType;
  }
  return pool;
}

// Creates the PendingImport row(s) for a resolved file: one row for an
// ordinary single-account file, or one row per detected account group when
// accountColumn is set — each group resolved deterministically (a cached
// hint, or exactly one type-narrowed candidate) where possible, falling back
// to a single batched agent call for whatever's still ambiguous.
async function createPendingImportRows(
  fileName: string,
  fileHash: string,
  fileType: "csv" | "xlsx",
  grid: ParsedGrid,
  resolved: ResolvedFileMapping,
  mappingSource: "cache_hit" | "agent",
  mappingCacheId: string | null,
  headerFingerprint: string | null,
  accounts: AccountBrief[],
  fileNotesSuffix?: string,
): Promise<void> {
  const columnMappingJson = {
    ...resolved.columnMapping,
    accountColumn: resolved.accountColumn,
    accountTypeColumn: resolved.accountTypeColumn,
    institutionGuess: resolved.institutionGuess,
  } as unknown as Prisma.InputJsonValue;

  if (resolved.accountColumn === null) {
    const rows = applyColumnMapping(grid, resolved.columnMapping);
    const status =
      resolved.overallConfidence !== null
        ? resolveInitialStatus(resolved.accountMatch, resolved.overallConfidence)
        : resolved.accountMatch
          ? "needs_review"
          : "needs_account";
    const notes = fileNotesSuffix ? `${resolved.notes ? `${resolved.notes} ` : ""}${fileNotesSuffix}` : resolved.notes;
    await prisma.pendingImport.create({
      data: {
        fileName,
        fileHash,
        fileType,
        status,
        mappingSource,
        mappingCacheId,
        accountId: resolved.accountMatch?.accountId ?? null,
        confidence: resolved.overallConfidence,
        rows,
        notes,
        headerFingerprint,
        columnMapping: columnMappingJson,
      },
    });
    return;
  }

  const groups = groupRowsByAccountColumn(grid, resolved.accountColumn, resolved.accountTypeColumn);
  const resolvedGroups: { group: AccountGroup; accountId: string | null; confidence: number | null; notes: string | null }[] = [];
  const ambiguous: { group: AccountGroup; candidates: AccountBrief[] }[] = [];

  for (const group of groups) {
    const hinted = resolved.accountIdHints[group.rawAccountId];
    if (hinted) {
      resolvedGroups.push({ group, accountId: hinted, confidence: null, notes: null });
      continue;
    }
    const candidates = narrowCandidates(accounts, group.accountType, resolved.institutionGuess);
    if (candidates.length === 1) {
      resolvedGroups.push({ group, accountId: candidates[0]!.id, confidence: null, notes: null });
    } else if (candidates.length === 0) {
      resolvedGroups.push({
        group,
        accountId: null,
        confidence: null,
        notes: `No household account matches type "${group.accountType ?? "unknown"}".`,
      });
    } else {
      ambiguous.push({ group, candidates });
    }
  }

  if (ambiguous.length > 0) {
    const input: AmbiguousAccountGroup[] = ambiguous.map(({ group, candidates }) => ({
      rawAccountId: group.rawAccountId,
      accountType: group.accountType,
      sampleRows: applyColumnMapping({ header: grid.header, rows: group.rows }, resolved.columnMapping),
      candidates,
    }));
    const matches = await resolveAmbiguousAccountGroups(input);
    const byRawId = new Map(matches.map((m) => [m.rawAccountId, m]));
    for (const { group } of ambiguous) {
      const match = byRawId.get(group.rawAccountId);
      resolvedGroups.push({
        group,
        accountId: match?.accountMatch?.accountId ?? null,
        confidence: match?.accountMatch?.confidence ?? null,
        notes: match?.notes ?? null,
      });
    }
  }

  for (const { group, accountId, confidence, notes } of resolvedGroups) {
    const rows = applyColumnMapping({ header: grid.header, rows: group.rows }, resolved.columnMapping);
    const status = confidence !== null ? resolveInitialStatus(accountId ? { accountId, confidence } : null, confidence) : accountId ? "needs_review" : "needs_account";
    const combinedNotes = [
      `Split from a multi-account file — raw account id "${group.rawAccountId}"${group.accountType ? ` (${group.accountType})` : ""}.`,
      notes,
      fileNotesSuffix,
    ]
      .filter((s): s is string => Boolean(s))
      .join(" ");
    await prisma.pendingImport.create({
      data: {
        fileName,
        fileHash,
        fileType,
        groupKey: group.rawAccountId,
        rawAccountId: group.rawAccountId,
        status,
        mappingSource,
        mappingCacheId,
        accountId,
        confidence,
        rows,
        notes: combinedNotes,
        headerFingerprint,
        columnMapping: columnMappingJson,
      },
    });
  }
}
