import { parseAmountValue, parseDateValue, type ImportAmountMode, type ImportDateFormat, type ImportRow } from "@panditas/shared";
import type { ParsedGrid } from "./csvParse.js";

export interface ColumnMapping {
  dateColumn: number;
  dateFormat: ImportDateFormat;
  payeeColumn: number | null;
  memoColumn: number | null;
  amountMode: ImportAmountMode;
  amountColumn: number | null;
  flipSign: boolean;
  debitColumn: number | null;
  creditColumn: number | null;
}

// Deterministic application of a column mapping — same logic as Import.tsx's
// normalizedRows, just server-side so a cache-hit CSV never needs the agent.
// Rows that fail to parse (bad date, missing/zero amount) are silently
// dropped, matching the manual-import UI's "skipped" behavior.
export function applyColumnMapping(grid: ParsedGrid, mapping: ColumnMapping): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const row of grid.rows) {
    const postedAt = parseDateValue(row[mapping.dateColumn] ?? "", mapping.dateFormat);

    let amount: number | null = null;
    if (mapping.amountMode === "single") {
      const raw = mapping.amountColumn !== null ? parseAmountValue(row[mapping.amountColumn] ?? "") : null;
      amount = raw === null ? null : mapping.flipSign ? -raw : raw;
    } else {
      const debit = mapping.debitColumn !== null ? parseAmountValue(row[mapping.debitColumn] ?? "") : null;
      const credit = mapping.creditColumn !== null ? parseAmountValue(row[mapping.creditColumn] ?? "") : null;
      if (debit !== null || credit !== null) amount = (credit ?? 0) - Math.abs(debit ?? 0);
    }

    if (!postedAt || amount === null || amount === 0) continue;

    rows.push({
      postedAt,
      amount,
      payee: mapping.payeeColumn !== null ? row[mapping.payeeColumn]?.trim() || null : null,
      memo: mapping.memoColumn !== null ? row[mapping.memoColumn]?.trim() || null : null,
    });
  }
  return rows;
}

export interface AccountGroup {
  rawAccountId: string;
  // e.g. "TFSA", "Chequing" — from accountTypeColumn, when the file has one.
  accountType: string | null;
  rows: string[][];
}

// Splits a multi-account file's raw rows by its per-row account-identifier
// column (e.g. Wealthsimple's account_id) — purely mechanical grouping, no
// agent call. Rows with a blank identifier are dropped (nothing to attach
// them to). accountType is read from the first row of each group — assumed
// constant per raw account id, which holds for every export format seen so far.
export function groupRowsByAccountColumn(
  grid: ParsedGrid,
  accountColumn: number,
  accountTypeColumn: number | null,
): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  for (const row of grid.rows) {
    const rawAccountId = (row[accountColumn] ?? "").trim();
    if (!rawAccountId) continue;
    let group = groups.get(rawAccountId);
    if (!group) {
      const accountType = accountTypeColumn !== null ? (row[accountTypeColumn]?.trim() || null) : null;
      group = { rawAccountId, accountType, rows: [] };
      groups.set(rawAccountId, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}
