import { read, utils } from "xlsx";
import type { ParsedGrid } from "./csvParse.js";

export interface ParsedXlsx extends ParsedGrid {
  // First sheet only for v1 — surfaced so the caller can flag it in the
  // PendingImport's notes rather than silently dropping the other sheets.
  hadMultipleSheets: boolean;
}

export function parseXlsx(bytes: Buffer): ParsedXlsx {
  const workbook = read(bytes, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { header: [], rows: [], hadMultipleSheets: false };

  const sheet = workbook.Sheets[sheetName]!;
  // raw:false formats values the way Excel would display them (dates,
  // currency) as strings — same string-grid shape csvParse produces, so
  // normalize.ts's column mapping works identically for both file types.
  const grid = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  const [firstRow, ...rest] = grid;
  if (!firstRow) return { header: [], rows: [], hadMultipleSheets: workbook.SheetNames.length > 1 };

  return {
    header: firstRow.map((h, i) => (h ?? "").trim() || `Column ${i + 1}`),
    rows: rest.map((row) => row.map((cell) => cell ?? "")),
    hadMultipleSheets: workbook.SheetNames.length > 1,
  };
}
