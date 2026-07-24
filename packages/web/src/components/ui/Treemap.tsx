import { formatMoney } from "@panditas/shared";
import { contrastText, toneColor, type DonutTone } from "./chartColors";

export interface TreemapCell {
  label: string;
  value: number;
  // Omitted for the "Other" rollup cell — nothing to navigate to directly.
  key?: string;
  isOther?: boolean;
}

const OTHER_FILL = "repeating-linear-gradient(135deg, #94a3b8, #94a3b8 6px, #cbd5e1 6px, #cbd5e1 12px)";

/**
 * Split cells into 1 or 2 rows. Real account balances are often lopsided
 * (one loan can be 10-40x the next-largest balance) — always pairing the top
 * 2 cells in row 1 breaks down there, squeezing the #2 cell toward zero
 * width and starving row 2 of height entirely. When the single largest cell
 * already dominates the section (≥50% of the total), give it a full-width
 * row of its own instead, so the rest of row 2 only has to divide up
 * whatever's left of the *set*, not fight the outlier for space.
 */
function splitRows(data: TreemapCell[]): TreemapCell[][] {
  if (data.length <= 2) return [data];
  const total = data.reduce((sum, c) => sum + c.value, 0);
  const dominant = total > 0 && data[0]!.value / total >= 0.5;
  return dominant ? [data.slice(0, 1), data.slice(1)] : [data.slice(0, 2), data.slice(2)];
}

/** Balance-proportional cells instead of a donut slice — the caller supplies
 * a small, pre-capped, pre-sorted set (top N + one "Other" rollup), not
 * arbitrary data, so this always lays out as 1-2 rows (see `splitRows`)
 * rather than running a general squarified-treemap algorithm. Sized by
 * sqrt(value) rather than value directly — still strictly ordered
 * (bigger balance always reads as a bigger cell), but compresses how hard an
 * extreme outlier crowds out everything else, which pure linear-area sizing
 * doesn't handle well for real (often lopsided) account balances. Each cell
 * is a real <button> — keyboard focusable, unlike Donut's SVG-based click
 * target. */
export function Treemap({
  data,
  tone,
  height = 220,
  onCellClick,
}: {
  data: TreemapCell[];
  tone: Exclude<DonutTone, "categorical">;
  height?: number;
  onCellClick?: (cell: TreemapCell, index: number) => void;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No data yet.</p>;
  }

  const rows = splitRows(data);
  const weight = (cell: TreemapCell) => Math.sqrt(cell.value) || 1;

  return (
    <div className="flex min-h-0 flex-col gap-1" style={{ height }}>
      {rows.map((row, ri) => {
        const rowWeight = row.reduce((sum, c) => sum + weight(c), 0);
        return (
          <div key={ri} className="flex min-h-0 gap-1" style={{ flex: rowWeight }}>
            {row.map((cell, ci) => {
              const index = ri === 0 ? ci : ci + rows[0]!.length;
              const fill = cell.isOther ? OTHER_FILL : toneColor(tone, index);
              const textColor = cell.isOther ? "#1e293b" : contrastText(toneColor(tone, index));
              return (
                <button
                  key={cell.key ?? cell.label}
                  type="button"
                  onClick={() => onCellClick?.(cell, index)}
                  style={{ flex: weight(cell), background: fill, color: textColor }}
                  className="min-h-0 min-w-0 overflow-hidden rounded-md p-2 text-left transition hover:brightness-95"
                >
                  <p className="truncate text-xs font-semibold">{cell.label}</p>
                  <p className="truncate text-[11px] opacity-90">{formatMoney(cell.value)}</p>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
