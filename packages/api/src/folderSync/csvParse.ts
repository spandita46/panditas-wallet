import Papa from "papaparse";

export interface ParsedGrid {
  header: string[];
  rows: string[][];
}

// Same shape the manual-import UI's Papa.parse produces (Import.tsx), always
// treating the first row as a header — bank exports overwhelmingly ship one,
// and folder sync has no "hasHeaderRow" checkbox to ask the user (nothing to
// ask, since a human never sees this step for a cache hit or an agent call).
export function parseCsv(bytes: Buffer): ParsedGrid {
  const text = bytes.toString("utf-8");
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const [firstRow, ...rest] = result.data;
  if (!firstRow) return { header: [], rows: [] };
  return {
    header: firstRow.map((h, i) => h.trim() || `Column ${i + 1}`),
    rows: rest,
  };
}
