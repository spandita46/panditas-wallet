// Fixed-order categorical palette for chart identity (which series/person/type) —
// 8 hues, CVD-separated, assigned by index and never reordered/cycled per chart.
export const CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
];

export function categoricalColor(index: number): string {
  return CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length] ?? CATEGORICAL_PALETTE[0]!;
}

// Tonal (single-hue-family) palettes for donuts that represent a semantic
// group rather than arbitrary identity — assets in shades of green, liabilities
// in shades of red/maroon — so the slice color reinforces asset-vs-liability
// at a glance instead of relying on the generic categorical palette.
const ASSET_TONAL = ["#059669", "#10b981", "#047857", "#34d399", "#065f46", "#6ee7b7"]; // emerald 600/500/700/400/800/300
const LIABILITY_TONAL = ["#be123c", "#e11d48", "#9f1239", "#fb7185", "#881337", "#fda4af"]; // rose 700/600/800/400/900/300

export type DonutTone = "categorical" | "asset" | "liability";

export function toneColor(tone: DonutTone, index: number): string {
  const palette = tone === "asset" ? ASSET_TONAL : tone === "liability" ? LIABILITY_TONAL : CATEGORICAL_PALETTE;
  return palette[index % palette.length] ?? palette[0]!;
}

// Diverging emerald<->rose steps for the spending/income calendar heatmap: a
// day's net (income - expense) reads green when net-positive, red when
// net-negative, intensity scaled by magnitude relative to the period's max.
const POSITIVE_STEPS = [
  { bg: "bg-asset-100", text: "text-asset-800" },
  { bg: "bg-asset-200", text: "text-asset-900" },
  { bg: "bg-asset-400", text: "text-white" },
  { bg: "bg-asset-600", text: "text-white" },
  { bg: "bg-asset-700", text: "text-white" },
];
const NEGATIVE_STEPS = [
  { bg: "bg-liability-100", text: "text-liability-800" },
  { bg: "bg-liability-200", text: "text-liability-900" },
  { bg: "bg-liability-400", text: "text-white" },
  { bg: "bg-liability-600", text: "text-white" },
  { bg: "bg-liability-700", text: "text-white" },
];
const NEUTRAL_STEP = { bg: "bg-slate-100", text: "text-slate-500" };

export function flowIntensity(net: number, maxAbs: number): { bg: string; text: string } {
  if (net === 0 || maxAbs === 0) return NEUTRAL_STEP;
  const steps = net > 0 ? POSITIVE_STEPS : NEGATIVE_STEPS;
  const frac = Math.min(1, Math.abs(net) / maxAbs);
  const idx = frac < 0.15 ? 0 : frac < 0.35 ? 1 : frac < 0.6 ? 2 : frac < 0.85 ? 3 : 4;
  return steps[idx] ?? NEUTRAL_STEP;
}
