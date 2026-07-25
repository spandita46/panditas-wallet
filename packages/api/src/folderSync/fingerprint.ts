import { createHash } from "node:crypto";

// Dedupes rescans of the same file — content-addressed, not name/mtime-based,
// so a re-dropped copy of an already-processed file is recognized even if
// the filename changed.
export function hashFileBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Cache key for FolderSyncMapping: normalize the header row so cosmetic
// differences (case, surrounding whitespace) don't miss an otherwise-identical
// format, then hash. Column order matters — a reordered export is a different
// format as far as the mapping cache is concerned.
export function hashHeaderRow(header: string[]): string {
  const normalized = header.map((h) => h.trim().toLowerCase()).join("|");
  return createHash("sha256").update(normalized).digest("hex");
}
